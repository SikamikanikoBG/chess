import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

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

  // Tiny markdown → HTML renderer for the changelog only. Keeps the bundle small.
  const html = renderChangelog(content);

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
            : <div className="prose-changelog text-sm" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      </div>
    </div>
  );
}

// Minimal markdown renderer for our CHANGELOG: headings, bold, lists, links, paragraphs.
function renderChangelog(md: string): string {
  if (!md) return '';
  const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!
  ));
  const inline = (s: string) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-ink-100 px-1 py-0.5 text-[12px] dark:bg-ink-700">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="text-accent-600 underline" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = escapeHtml(raw);
    if (/^#{1,6}\s/.test(raw)) {
      if (inList) { out.push('</ul>'); inList = false; }
      const m = raw.match(/^(#{1,6})\s+(.*)$/)!;
      const lvl = m[1].length;
      const sizeClass = lvl === 1 ? 'text-xl font-bold mt-4 mb-2'
        : lvl === 2 ? 'text-lg font-semibold mt-4 mb-2'
        : 'text-base font-semibold mt-3 mb-1';
      out.push(`<h${lvl} class="${sizeClass}">${inline(escapeHtml(m[2]))}</h${lvl}>`);
    } else if (/^\s*-\s+/.test(raw)) {
      if (!inList) { out.push('<ul class="ml-5 list-disc space-y-1 mb-2">'); inList = true; }
      const item = raw.replace(/^\s*-\s+/, '');
      out.push(`<li>${inline(escapeHtml(item))}</li>`);
    } else if (raw.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p class="mb-2 text-ink-700 dark:text-ink-300">${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}
