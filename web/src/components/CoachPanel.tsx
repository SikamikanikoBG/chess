import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Volume2, VolumeX, Pause, Play } from 'lucide-react';
import { useAuth } from '../state/auth';
import { speak, cancel as cancelSpeak } from '../lib/tts';

interface Props {
  systemConfigured: boolean;
  request: (() => { url: string; body: Record<string, unknown> }) | null;
  /** When true, auto-fetches whenever `triggerKey` changes (debounced). */
  autoPlay?: boolean;
  /** Changes to this value re-trigger the request in autoPlay mode. */
  triggerKey?: string | number;
  /** Debounce in ms before firing in autoPlay mode (default 600). */
  debounceMs?: number;
  /** Compact rendering for tight spaces. */
  compact?: boolean;
}

export default function CoachPanel({ systemConfigured, request, autoPlay, triggerKey, debounceMs = 600, compact }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  async function ask() {
    if (!request) return;
    cancelSpeak(); setSpeaking(false);
    abortRef.current?.abort();
    const ac = new AbortController(); abortRef.current = ac;

    setText(''); setBusy(true); setError(null);
    const { url, body } = request();
    let acc = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`); setBusy(false); return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) {
              acc += line.slice(5).trimStart();
              setText(acc);
            } else if (line.startsWith('event: error')) {
              setError('coach error');
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
      if (autoPlay && acc.trim() && user?.profile.tts_enabled && !muted) {
        playTts(acc);
      }
    }
  }

  function playTts(s?: string) {
    const content = s ?? text;
    if (!content.trim() || !user) return;
    setSpeaking(true);
    const u = speak(content, {
      voice: user.profile.tts_voice,
      rate: user.profile.tts_rate,
      pitch: user.profile.tts_pitch,
      lang: user.profile.language,
    });
    if (u) u.onend = () => setSpeaking(false);
  }

  function toggleMute() {
    if (muted) { setMuted(false); return; }
    setMuted(true);
    abortRef.current?.abort();
    cancelSpeak(); setSpeaking(false); setBusy(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }

  // Always-on mode: re-fetch (debounced) when triggerKey changes
  useEffect(() => {
    if (!autoPlay || !request || muted) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void ask(); }, debounceMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey, autoPlay, muted]);

  // On unmount, cancel everything
  useEffect(() => () => { abortRef.current?.abort(); cancelSpeak(); }, []);

  if (!systemConfigured) {
    return (
      <div className="card p-4 text-sm text-ink-500">
        {t('coach.notConfigured')}
      </div>
    );
  }

  return (
    <div className={compact ? 'card p-3' : 'card p-4'}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-accent-500" />
          {t('coach.title')}
        </div>
        <div className="flex items-center gap-1">
          {!autoPlay && request && (
            <button onClick={ask} disabled={busy} className="btn-secondary text-xs">
              {t('coach.askExplain', { cls: '?' })}
            </button>
          )}
          {autoPlay && (
            <button
              onClick={toggleMute}
              className="btn-ghost p-1.5"
              title={muted ? 'Resume coach' : 'Mute coach'}
            >
              {muted ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
          )}
          {text && !muted && (
            speaking
              ? <button onClick={() => { cancelSpeak(); setSpeaking(false); }} className="btn-ghost p-1.5"><VolumeX className="h-4 w-4" /></button>
              : <button onClick={() => playTts()} className="btn-ghost p-1.5"><Volume2 className="h-4 w-4" /></button>
          )}
        </div>
      </div>
      {muted && <div className="text-sm text-ink-400 italic">— muted —</div>}
      {!muted && busy && !text && <div className="text-sm text-ink-500">{t('coach.thinking')}</div>}
      {!muted && text && <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800 dark:text-ink-100">{text}</div>}
      {!muted && error && <div className="text-sm text-bad">{error}</div>}
    </div>
  );
}
