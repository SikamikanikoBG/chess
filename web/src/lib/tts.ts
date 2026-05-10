// Wrapper around the browser Web Speech API. On Edge/Chrome on Windows this uses
// installed Windows SAPI voices, which include Bulgarian (Microsoft Ivan) when
// the BG language pack is installed.

export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices();
}

export function onVoicesReady(cb: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => {};
  if (speechSynthesis.getVoices().length > 0) { cb(); return () => {}; }
  const handler = () => cb();
  speechSynthesis.addEventListener('voiceschanged', handler);
  return () => speechSynthesis.removeEventListener('voiceschanged', handler);
}

export function voicesForLang(lang: 'en' | 'bg'): SpeechSynthesisVoice[] {
  const prefix = lang === 'bg' ? 'bg' : 'en';
  return getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

export interface SpeakOpts { voice?: string | null; rate?: number; pitch?: number; lang?: 'en' | 'bg' }

export function speak(text: string, opts: SpeakOpts = {}): SpeechSynthesisUtterance | null {
  if (typeof speechSynthesis === 'undefined' || !text.trim()) return null;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;
  if (opts.voice) {
    const match = getVoices().find((v) => v.voiceURI === opts.voice || v.name === opts.voice);
    if (match) u.voice = match;
  } else if (opts.lang) {
    const voices = voicesForLang(opts.lang);
    if (voices.length > 0 && voices[0]) u.voice = voices[0];
  }
  speechSynthesis.speak(u);
  return u;
}

export function cancel() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
