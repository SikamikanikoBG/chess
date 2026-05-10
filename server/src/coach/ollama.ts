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
// Hard timeout (default 120s) and idle timeout (default 30s) ensure silent
// failures (model loading forever, network hung) become loud errors.
export async function chatStream(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  opts: { model?: string; temperature?: number; topP?: number; numPredict?: number; signal?: AbortSignal; hardTimeoutMs?: number; idleTimeoutMs?: number } = {},
): Promise<void> {
  const url = ollamaUrl();
  if (!url) throw new Error('ollama_not_configured');
  const model = opts.model ?? ollamaModel();
  const hardMs = opts.hardTimeoutMs ?? 120_000;
  const idleMs = opts.idleTimeoutMs ?? 30_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const hardTimer = setTimeout(() => ac.abort(new Error('ollama_hard_timeout')), hardMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(new Error('ollama_idle_timeout')), idleMs);
  }
  bumpIdle();

  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        // num_predict caps the worst-case token blast — coach sentences rarely
        // need more than ~220 tokens. top_p keeps the model from venturing into
        // rare-token rambles when temperature is already low.
        options: {
          temperature: opts.temperature ?? 0.3,
          top_p: opts.topP ?? 0.9,
          num_predict: opts.numPredict ?? 220,
        },
      }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`ollama_http_${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bumpIdle();
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
          if (obj.error) throw new Error(`ollama_${obj.error}`);
          const text = obj.message?.content;
          if (text) onChunk(text);
        } catch (err) {
          if ((err as Error).message?.startsWith('ollama_')) throw err;
          // ignore malformed JSON lines
        }
      }
    }
  } finally {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

// Non-streaming JSON-mode call. Used for batched game review where we need
// structured output (per-move comments + summary) in one response. Ollama's
// `format: "json"` constrains the model to valid JSON; we still parse defensively.
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const url = ollamaUrl();
  if (!url) throw new Error('ollama_not_configured');
  const model = opts.model ?? ollamaModel();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(new Error('ollama_hard_timeout')), timeoutMs);
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: 'json',
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.numPredict ?? 1500,
        },
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`ollama_http_${res.status}`);
    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) throw new Error(`ollama_${data.error}`);
    const raw = data.message?.content ?? '';
    // Some models still wrap JSON in fences despite format:"json". Strip them.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`ollama_bad_json: ${(err as Error).message}: ${cleaned.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

// Quick smoke test of a single model — sends a tiny prompt and reports timing.
export async function testModel(url: string, model: string, timeoutMs = 30_000): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) return { ok: false, latencyMs, error: data.error };
    const sample = (data.message?.content ?? '').trim().slice(0, 80);
    return { ok: !!sample, latencyMs, sample };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}
