import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../state/auth';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/api/auth/login', { username, password });
      await refresh();
      nav('/');
    } catch {
      setError(t('login.invalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream dark:bg-ink-900">
      <div className="mx-auto max-w-sm px-6 py-16">
        <div className="mb-8 text-center">
          <div className="mb-2 text-5xl">♞</div>
          <h1 className="text-2xl font-bold">{t('app.name')}</h1>
          <p className="text-sm text-ink-500">{t('app.tagline')}</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">{t('login.title')}</h2>
          <div>
            <label className="label mb-1 block">{t('common.username')}</label>
            <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">{t('common.password')}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="text-sm text-bad">{error}</div>}
          <button type="submit" disabled={busy || !username || !password} className="btn-primary w-full">
            {busy ? t('login.submitting') : t('login.submit')}
          </button>
          <div className="flex justify-center gap-3 text-xs text-ink-400">
            <button type="button" onClick={() => i18n.changeLanguage('en')} className="hover:text-ink-700">EN</button>
            <span>·</span>
            <button type="button" onClick={() => i18n.changeLanguage('bg')} className="hover:text-ink-700">BG</button>
          </div>
        </form>
      </div>
    </div>
  );
}
