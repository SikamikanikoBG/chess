import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Save } from 'lucide-react';
import { api } from '../../api';

interface SysSettings {
  ollama_url: string | null;
  ollama_model: string | null;
  stockfish_path: string | null;
}

export default function AdminSystem() {
  const { t } = useTranslation();
  const [s, setS] = useState<SysSettings>({ ollama_url: '', ollama_model: '', stockfish_path: '' });
  const [models, setModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [stockfishStatus, setStockfishStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<SysSettings>('/api/admin/system').then((d) => {
      setS({ ollama_url: d.ollama_url ?? '', ollama_model: d.ollama_model ?? '', stockfish_path: d.stockfish_path ?? '' });
    });
  }, []);

  async function testOllama() {
    setOllamaStatus(null); setModels([]);
    const r = await api.post<{ ok: boolean; models?: { name: string }[]; error?: string }>('/api/admin/test/ollama', { url: s.ollama_url });
    if (r.ok) {
      const ns = (r.models ?? []).map((m) => m.name);
      setModels(ns);
      setOllamaStatus({ ok: true, msg: `${ns.length} models` });
      if (!s.ollama_model && ns[0]) setS({ ...s, ollama_model: ns[0] });
    } else {
      setOllamaStatus({ ok: false, msg: r.error ?? 'failed' });
    }
  }

  async function testStockfish() {
    setStockfishStatus(null);
    const r = await api.post<{ ok: boolean; name?: string; error?: string }>('/api/admin/test/stockfish', { path: s.stockfish_path });
    setStockfishStatus({ ok: r.ok, msg: r.ok ? (r.name ?? 'ok') : (r.error ?? 'failed') });
  }

  async function save() {
    await api.patch('/api/admin/system', s);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.system')}</h1>
      <p className="text-sm text-ink-500">{t('admin.system_intro')}</p>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('admin.ollamaConfig')}</h2>
        <div className="space-y-3">
          <div>
            <label className="label mb-1 block">{t('admin.ollamaUrl')}</label>
            <input className="input" value={s.ollama_url ?? ''} onChange={(e) => setS({ ...s, ollama_url: e.target.value })} placeholder="http://localhost:11434" />
          </div>
          <div className="flex gap-2">
            <button onClick={testOllama} className="btn-secondary text-sm" disabled={!s.ollama_url}>{t('admin.ollamaTest')}</button>
            {ollamaStatus && (
              <span className={`flex items-center gap-1 text-sm ${ollamaStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {ollamaStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {ollamaStatus.msg}
              </span>
            )}
          </div>
          {models.length > 0 ? (
            <div>
              <label className="label mb-1 block">{t('admin.ollamaModel')}</label>
              <select className="input" value={s.ollama_model ?? ''} onChange={(e) => setS({ ...s, ollama_model: e.target.value })}>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="label mb-1 block">{t('admin.ollamaModel')}</label>
              <input className="input" value={s.ollama_model ?? ''} onChange={(e) => setS({ ...s, ollama_model: e.target.value })} placeholder="gemma3:1b" />
            </div>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">{t('admin.stockfishConfig')}</h2>
        <div className="space-y-3">
          <div>
            <label className="label mb-1 block">{t('admin.stockfishPath')}</label>
            <input className="input" value={s.stockfish_path ?? ''} onChange={(e) => setS({ ...s, stockfish_path: e.target.value })} placeholder="(auto)" />
            <div className="mt-1 text-xs text-ink-400">{t('admin.stockfishPathHelp')}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={testStockfish} className="btn-secondary text-sm">{t('admin.stockfishTest')}</button>
            {stockfishStatus && (
              <span className={`flex items-center gap-1 text-sm ${stockfishStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {stockfishStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {t('admin.engineFound', { name: stockfishStatus.msg })}
              </span>
            )}
          </div>
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
