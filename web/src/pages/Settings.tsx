import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Save } from 'lucide-react';
import { api } from '../api';
import { useAuth, type Profile } from '../state/auth';
import { getVoices, onVoicesReady, speak } from '../lib/tts';

const EMOJIS = ['♟','♞','♝','♜','♛','♚','🦊','🐯','🦁','🐻','🐼','🐰','🐶','🐱','🐹','🐢','🐧','🐳','⭐','🌟'];

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState<Profile | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (user) setForm({ ...user.profile }); }, [user]);
  useEffect(() => onVoicesReady(() => setVoices(getVoices())), []);

  if (!form) return null;

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setForm((f) => f ? { ...f, [k]: v } : f);
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    await api.patch('/api/settings/profile', {
      display_name: form.display_name,
      avatar_emoji: form.avatar_emoji,
      language: form.language,
      audience: form.audience,
      chesscom_username: form.chesscom_username || null,
      coach_behavior: form.coach_behavior,
      tts_enabled: !!form.tts_enabled,
      tts_voice: form.tts_voice,
      tts_rate: form.tts_rate,
      tts_pitch: form.tts_pitch,
      board_theme: form.board_theme,
      piece_set: form.piece_set,
      site_theme: form.site_theme,
    });
    await i18n.changeLanguage(form.language);
    await refresh();
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  function BoardSwatch({ theme }: { theme: 'wood' | 'green' | 'blue' }) {
    const colors = {
      wood:  { l: '#f0d9b5', d: '#b58863' },
      green: { l: '#eeeed2', d: '#769656' },
      blue:  { l: '#dee3e6', d: '#788a94' },
    }[theme];
    return (
      <div className="grid h-10 grid-cols-4 grid-rows-4 overflow-hidden rounded">
        {Array.from({ length: 16 }).map((_, i) => {
          const x = i % 4; const y = Math.floor(i / 4);
          const isDark = (x + y) % 2 === 1;
          return <div key={i} style={{ background: isDark ? colors.d : colors.l }} />;
        })}
      </div>
    );
  }

  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(form.language === 'bg' ? 'bg' : 'en'));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('settings.profile')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label mb-1 block">{t('settings.displayName')}</label>
            <input className="input" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.avatar')}</label>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((emoji) => (
                <button key={emoji} onClick={() => set('avatar_emoji', emoji)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg
                    ${form.avatar_emoji === emoji ? 'bg-ink-900 text-cream dark:bg-cream dark:text-ink-900' : 'hover:bg-ink-100 dark:hover:bg-ink-800'}`}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.language')}</label>
            <select className="input" value={form.language} onChange={(e) => set('language', e.target.value as 'en' | 'bg')}>
              <option value="en">{t('common.english')}</option>
              <option value="bg">{t('common.bulgarian')}</option>
            </select>
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.audience')}</label>
            <select className="input" value={form.audience} onChange={(e) => set('audience', e.target.value as Profile['audience'])}>
              <option value="kid">{t('settings.audienceLevel.kid')}</option>
              <option value="beginner">{t('settings.audienceLevel.beginner')}</option>
              <option value="intermediate">{t('settings.audienceLevel.intermediate')}</option>
              <option value="advanced">{t('settings.audienceLevel.advanced')}</option>
            </select>
            <div className="mt-1 text-xs text-ink-400">{t('settings.audienceHelp')}</div>
          </div>
          <div className="sm:col-span-2">
            <label className="label mb-1 block">{t('settings.chessCom')}</label>
            <input className="input" value={form.chesscom_username ?? ''} onChange={(e) => set('chesscom_username', e.target.value)} placeholder="username" />
            <div className="mt-1 text-xs text-ink-400">{t('settings.chessComHelp')}</div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('settings.appearance')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label mb-1 block">{t('settings.siteTheme')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['light','dark','auto'] as const).map((th) => (
                <button key={th} onClick={() => set('site_theme', th)}
                  className={`btn text-xs ${form.site_theme === th ? 'btn-primary' : 'btn-secondary'}`}>
                  {t(`settings.siteTheme${th[0]!.toUpperCase()}${th.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.boardTheme')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['wood','green','blue'] as const).map((th) => (
                <button key={th} onClick={() => set('board_theme', th)}
                  className={`relative overflow-hidden rounded-xl border p-2 text-xs font-medium transition-colors
                    ${form.board_theme === th ? 'border-ink-900 dark:border-cream' : 'border-ink-200 hover:border-ink-300 dark:border-ink-700'}`}>
                  <BoardSwatch theme={th} />
                  <div className="mt-2">{t(`settings.board${th[0]!.toUpperCase()}${th.slice(1)}`)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {user?.role === 'admin' && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-50 px-4 py-3 text-sm text-accent-700 dark:bg-accent-700/10 dark:text-accent-300">
          {t('settings.adminHint')}
        </div>
      )}

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('coach.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label mb-1 block">{t('settings.coachBehavior')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['silent','on_demand','always_on_pedagogical'] as const).map((b) => (
                <button key={b} onClick={() => set('coach_behavior', b)}
                  className={`btn ${form.coach_behavior === b ? 'btn-primary' : 'btn-secondary'} text-xs`}>
                  {t(`coach.behavior.${b}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('settings.tts')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={!!form.tts_enabled} onChange={(e) => set('tts_enabled', e.target.checked ? 1 : 0)} />
            <span className="text-sm">{t('settings.ttsEnable')}</span>
          </label>
          <div className="sm:col-span-2">
            <label className="label mb-1 block">{t('settings.ttsVoice')}</label>
            <select className="input" value={form.tts_voice ?? ''} onChange={(e) => set('tts_voice', e.target.value || null)}>
              <option value="">{t('settings.ttsVoiceNone')}</option>
              {langVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.ttsRate')}: {form.tts_rate.toFixed(2)}</label>
            <input type="range" min={0.5} max={2} step={0.05} value={form.tts_rate} onChange={(e) => set('tts_rate', Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <label className="label mb-1 block">{t('settings.ttsPitch')}: {form.tts_pitch.toFixed(2)}</label>
            <input type="range" min={0} max={2} step={0.05} value={form.tts_pitch} onChange={(e) => set('tts_pitch', Number(e.target.value))} className="w-full" />
          </div>
          <button onClick={() => {
            const text = form.language === 'bg' ? t('settings.ttsPreviewTextBg') : t('settings.ttsPreviewText');
            speak(text, { voice: form.tts_voice, rate: form.tts_rate, pitch: form.tts_pitch, lang: form.language });
          }} className="btn-secondary self-end text-sm sm:col-span-2">
            <Volume2 className="h-4 w-4" /> {t('settings.ttsPreview')}
          </button>
        </div>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <button onClick={save} className="btn-primary shadow-lg">
          <Save className="h-4 w-4" /> {saved ? t('settings.saved') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
