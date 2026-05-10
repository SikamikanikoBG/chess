import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { renderMarkdown } from '../lib/markdown';

interface Props { onClose: () => void }

export default function ChangelogModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/meta/changelog')
      .then((r) => r.text())
      .then((text) => { setContent(text); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-ink-200 p-4 dark:border-ink-700">
          <h2 className="text-lg font-semibold">CHANGELOG</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading
            ? <div className="text-ink-500">{t('common.loading')}</div>
            : <div className="text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />}
        </div>
      </div>
    </div>
  );
}
