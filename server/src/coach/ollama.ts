import { getSetting } from '../db.js';

export interface OllamaModel { name: string; size: number; details?: { parameter_size?: string } }

export function ollamaUrl(): string | null {
  const url = getSetting('ollama_url');
  return url ? url.replace(/\/$/, '') : null;
}

export function ollamaModel(): string {
  return getSetting('ollama_model') || 'gemma3:1b';
}

export async function testOllama(url: string): Promise<{ ok: true; models: OllamaModel[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: OllamaModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

// Streams response chunks. Calls `onChunk` per token batch.
export async function chatStream(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  opts: { model?: string; temperature?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const url = ollamaUrl();
  if (!url) throw new Error('ollama_not_configured');
  const model = opts.model ?? ollamaModel();

  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature: opts.temperature ?? 0.6 },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`ollama_${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        const text = obj.message?.content;
        if (text) onChunk(text);
      } catch { /* ignore malformed lines */ }
    }
  }
}
