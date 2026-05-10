import { useTranslation } from 'react-i18next';
import { CLASSIFICATIONS, type Classification, type AnalyzedMove } from '../types';

const GLYPH: Record<Classification, string> = {
  brilliant: '!!', best: '★', excellent: '✓', good: '·', book: '📖',
  inaccuracy: '?!', mistake: '?', blunder: '??', miss: '✗',
};

const TEXT_COLOR: Record<Classification, string> = {
  brilliant: 'text-move-brilliant',
  best: 'text-move-best',
  excellent: 'text-move-excellent',
  good: 'text-move-good',
  book: 'text-move-book',
  inaccuracy: 'text-move-inaccuracy',
  mistake: 'text-move-mistake',
  blunder: 'text-move-blunder',
  miss: 'text-move-miss',
};

interface Props {
  moves: AnalyzedMove[];
  whiteName: string;
  blackName: string;
  onClickClassification?: (cls: Classification, side: 'white' | 'black') => void;
}

export default function ClassificationStats({ moves, whiteName, blackName, onClickClassification }: Props) {
  const { t } = useTranslation();

  const counts = (() => {
    const w = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
    const b = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
    for (const m of moves) {
      const tgt = m.ply % 2 === 1 ? w : b;
      tgt[m.classification] += 1;
    }
    return { white: w, black: b };
  })();

  return (
    <div className="card overflow-hidden">
      <h3 className="border-b border-ink-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-700">
        {t('review.moves')}
      </h3>
      <div className="grid grid-cols-[1fr_auto_auto] items-center text-sm">
        <div className="bg-ink-50 px-4 py-1 text-[10px] uppercase tracking-wide text-ink-400 dark:bg-ink-900" />
        <div className="bg-ink-50 px-3 py-1 text-center text-[10px] uppercase tracking-wide text-ink-400 dark:bg-ink-900" title={whiteName}>
          ◯ {t('review.white')}
        </div>
        <div className="bg-ink-50 px-3 py-1 text-center text-[10px] uppercase tracking-wide text-ink-400 dark:bg-ink-900" title={blackName}>
          ● {t('review.black')}
        </div>
        {CLASSIFICATIONS.map((c) => (
          <Row key={c} cls={c} wCount={counts.white[c]} bCount={counts.black[c]}
               label={t(`classification.${c}`)} onSel={onClickClassification} />
        ))}
      </div>
    </div>
  );
}

function Row({ cls, label, wCount, bCount, onSel }:
  { cls: Classification; label: string; wCount: number; bCount: number;
    onSel?: (cls: Classification, side: 'white' | 'black') => void }) {
  const dim = wCount === 0 && bCount === 0;
  return (
    <>
      <div className={`flex items-center gap-2 border-t border-ink-100 px-4 py-1.5 dark:border-ink-800 ${dim ? 'opacity-40' : ''}`}>
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${TEXT_COLOR[cls]} bg-current/15`}>
          <span className={TEXT_COLOR[cls]}>{GLYPH[cls]}</span>
        </span>
        <span>{label}</span>
      </div>
      <div className={`border-t border-ink-100 px-3 py-1.5 text-center font-mono tabular-nums dark:border-ink-800 ${wCount > 0 ? 'cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800' : ''}`}
           onClick={() => wCount > 0 && onSel?.(cls, 'white')}>{wCount}</div>
      <div className={`border-t border-ink-100 px-3 py-1.5 text-center font-mono tabular-nums dark:border-ink-800 ${bCount > 0 ? 'cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800' : ''}`}
           onClick={() => bCount > 0 && onSel?.(cls, 'black')}>{bCount}</div>
    </>
  );
}
