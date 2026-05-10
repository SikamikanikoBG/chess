import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';

export default function Setup() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<'en' | 'bg'>(i18n.language === 'bg' ? 'bg' : 'en');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function testOllama() {
    setTestStatus('testing'); setTestError(''); setModels([]);
    try {
      const res = await fetch('/api/setup/test-ollama', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ollamaUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        const names = (data.models ?? []).map((m: { name: string }) => m.name);
        setModels(names);
        if (names.length && !ollamaModel) setOllamaModel(names[0]);
        setTestStatus('ok');
      } else {
        setTestStatus('fail'); setTestError(data.error ?? 'unknown');
      }
    } catch (err) {
      setTestStatus('fail'); setTestError((err as Error).message);
    }
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      await api.post('/api/setup/init', {
        username, password, display_name: displayName || username, language,
        ollama_url: ollamaUrl || '', ollama_model: ollamaModel || '',
      });
      await i18n.changeLanguage(language);
      await refresh();
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream dark:bg-ink-900">
      <div className="mx-auto max-w-xl px-6 py-12">
        <div className="mb-8 text-center">
          <div className="mb-3 text-6xl">♞</div>
          <h1 className="text-3xl font-bold">{t('setup.title')}</h1>
          <p className="mt-2 text-ink-500">{t('setup.subtitle')}</p>
        </div>

        <div className="card p-6">
          <ol className="mb-6 flex justify-center gap-2">
            <Dot active={step === 1} done={step > 1}>1</Dot>
            <Dot active={step === 2}>2</Dot>
          </ol>

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{t('setup.step1')}</h2>
              <div>
                <label className="label mb-1 block">{t('common.language')}</label>
                <div className="flex gap-2">
                  <LangBtn current={language} value="en" onClick={() => { setLanguage('en'); void i18n.changeLanguage('en'); }}>{t('common.english')}</LangBtn>
                  <LangBtn current={language} value="bg" onClick={() => { setLanguage('bg'); void i18n.changeLanguage('bg'); }}>{t('common.bulgarian')}</LangBtn>
                </div>
              </div>
              <div>
                <label className="label mb-1 block">{t('common.username')}</label>
                <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1 block">{t('common.displayName')}</label>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} />
              </div>
              <div>
                <label className="label mb-1 block">{t('common.password')}</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <button
                onClick={() => setStep(2)}
                disabled={!username || password.length < 6}
                className="btn-primary w-full"
              >
                {t('common.ok')} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">{t('setup.step2')}</h2>
              <p className="text-sm text-ink-500">{t('setup.ollamaSkip')}</p>
              <div>
                <label className="label mb-1 block">{t('setup.ollamaUrl')}</label>
                <input className="input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
                <div className="mt-1 text-xs text-ink-400">{t('setup.ollamaUrlHelp')}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={testOllama} className="btn-secondary text-sm" disabled={!ollamaUrl}>
                  {testStatus === 'testing' ? t('common.loading') : t('setup.ollamaTest')}
                </button>
                {testStatus === 'ok' && (
                  <span className="flex items-center gap-1 text-sm text-accent-600">
                    <CheckCircle2 className="h-4 w-4" /> {t('common.connected')}
                  </span>
                )}
                {testStatus === 'fail' && (
                  <span className="flex items-center gap-1 text-sm text-bad">
                    <AlertCircle className="h-4 w-4" /> {testError}
                  </span>
                )}
              </div>
              {models.length > 0 && (
                <div>
                  <label className="label mb-1 block">{t('setup.ollamaModel')}</label>
                  <select className="input" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              {error && <div className="text-sm text-bad">{error}</div>}
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="btn-ghost flex-1">{t('common.back')}</button>
                <button onClick={submit} disabled={busy} className="btn-primary flex-1">
                  {busy ? t('setup.creating') : t('setup.finish')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Dot({ active, done, children }: { active?: boolean; done?: boolean; children: React.ReactNode }) {
  return (
    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors
      ${active ? 'bg-ink-900 text-cream dark:bg-cream dark:text-ink-900' :
        done ? 'bg-accent-500 text-white' : 'bg-ink-200 text-ink-500'}`}>
      {children}
    </span>
  );
}

function LangBtn({ current, value, onClick, children }: { current: string; value: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`btn flex-1 ${current === value ? 'btn-primary' : 'btn-secondary'}`}>{children}</button>
  );
}
