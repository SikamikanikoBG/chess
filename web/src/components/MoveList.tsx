import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import type { Classification } from '../types';

const CLASS_BG: Record<Classification, string> = {
  best: 'bg-move-best/20 text-move-best',
  excellent: 'bg-move-excellent/20 text-move-excellent',
  good: 'bg-move-good/20 text-move-good',
  book: 'bg-move-book/20 text-move-book',
  inaccuracy: 'bg-move-inaccuracy/20 text-move-inaccuracy',
  mistake: 'bg-move-mistake/20 text-move-mistake',
  blunder: 'bg-move-blunder/20 text-move-blunder',
};

const CLASS_GLYPH: Record<Classification, string> = {
  best: '★',
  excellent: '✓',
  good: '·',
  book: '📖',
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
};

interface Move { ply: number; san: string; classification?: Classification }

interface Props {
  moves: Move[];
  current: number;
  onSelect: (ply: number) => void;
}

export default function MoveList({ moves, current, onSelect }: Props) {
  const { t } = useTranslation();
  const rows: { num: number; white?: Move; black?: Move }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ num: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  function MoveCell({ m }: { m?: Move }) {
    if (!m) return <td />;
    const isCurrent = m.ply === current;
    const cls = m.classification;
    return (
      <td
        onClick={() => onSelect(m.ply)}
        className={cn(
          'cursor-pointer rounded px-2 py-1 text-sm transition-colors',
          isCurrent ? 'bg-ink-900 text-cream dark:bg-cream dark:text-ink-900' : 'hover:bg-ink-100 dark:hover:bg-ink-800',
        )}
        title={cls ? t(`classification.${cls}`) : undefined}
      >
        <span className="inline-flex items-center gap-1">
          <span>{m.san}</span>
          {cls && (
            <span className={cn('badge text-[10px] px-1.5', CLASS_BG[cls], isCurrent && 'opacity-80')}>
              {CLASS_GLYPH[cls]}
            </span>
          )}
        </span>
      </td>
    );
  }

  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-ink-200 dark:border-ink-700">
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.num} className="border-b border-ink-100 last:border-0 dark:border-ink-800">
              <td className="w-8 px-2 py-1 text-right text-xs text-ink-400">{r.num}.</td>
              <MoveCell m={r.white} />
              <MoveCell m={r.black} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
