// Game Report card — the post-game summary panel. Replaces v3's plain
// SummaryCard with chess.com's accuracy donut + classification breakdown +
// per-phase mini-bar + estimated Elo strip.

import { Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AccuracyDonut from './AccuracyDonut';
import { CLASS_STYLE } from '../lib/classification';
import type { AnalyzedMove, Classification, PhaseSplit } from '../types';

interface Props {
  whiteName: string;
  blackName: string;
  accuracyW: number;
  accuracyB: number;
  eloW: number | null;
  eloB: number | null;
  perfW: number | null;
  perfB: number | null;
  moves: AnalyzedMove[];
  phaseSplit?: PhaseSplit | null;
  userColor?: 'white' | 'black' | null;
}

export default function GameReportCard({
  whiteName, blackName, accuracyW, accuracyB,
  eloW, eloB, perfW, perfB, moves, phaseSplit, userColor,
}: Props) {
  const { t } = useTranslation();
  const w = countByCls(moves, 'white');
  const b = countByCls(moves, 'black');

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
        <PlayerColumn name={whiteName} accuracy={accuracyW} elo={eloW} perf={perfW} side="white" highlighted={userColor === 'white'} />
        <PlayerColumn name={blackName} accuracy={accuracyB} elo={eloB} perf={perfB} side="black" highlighted={userColor === 'black'} />
      </div>

      {phaseSplit && (
        <div className="border-t border-chesscom-100 bg-chesscom-50/40 px-4 py-3 text-xs dark:border-chesscom-700 dark:bg-chesscom-900/40">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-chesscom-500">{t('review.phases', { defaultValue: 'Phases' })}</div>
          <div className="grid grid-cols-3 gap-2">
            <PhaseTile label={t('review.opening', { defaultValue: 'Opening' })} phase={phaseSplit.opening} userColor={userColor} />
            <PhaseTile label={t('review.middlegame', { defaultValue: 'Middlegame' })} phase={phaseSplit.middlegame} userColor={userColor} />
            <PhaseTile label={t('review.endgame', { defaultValue: 'Endgame' })} phase={phaseSplit.endgame} userColor={userColor} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 border-t border-chesscom-100 px-4 py-2 text-[10px] uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700">
        <span>{t('review.moves', { defaultValue: 'Move' })}</span>
        <span className="text-center">W</span>
        <span className="text-center">B</span>
      </div>
      {([...Object.keys(CLASS_STYLE)] as Classification[])
        .sort((a, b) => CLASS_STYLE[a].order - CLASS_STYLE[b].order)
        .map((c) => {
          const wc = w[c] ?? 0;
          const bc = b[c] ?? 0;
          if (wc === 0 && bc === 0) return null;
          const s = CLASS_STYLE[c];
          return (
            <div key={c} className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 px-4 py-1 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${s.bgClass}`} />
                <span>{t(`classification.${s.labelKey}`)}</span>
              </div>
              <span className={`text-center font-mono tabular-nums ${wc > 0 ? '' : 'opacity-30'}`}>{wc}</span>
              <span className={`text-center font-mono tabular-nums ${bc > 0 ? '' : 'opacity-30'}`}>{bc}</span>
            </div>
          );
        })}
    </div>
  );
}

function PlayerColumn({ name, accuracy, elo, perf, side, highlighted }: { name: string; accuracy: number; elo: number | null; perf: number | null; side: 'white' | 'black'; highlighted?: boolean }) {
  const sideDot = side === 'white' ? 'bg-white border border-chesscom-300' : 'bg-chesscom-900';
  return (
    <div className={`rounded-xl border p-3 ${highlighted ? 'border-gold-500/50 bg-gold-50/40 dark:bg-gold-700/10' : 'border-chesscom-200 dark:border-chesscom-700'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${sideDot}`} />
        <span className="truncate text-xs font-medium text-chesscom-500">{side === 'white' ? 'White' : 'Black'}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{name}</div>
      <div className="mt-2 flex items-center gap-3">
        <AccuracyDonut value={accuracy} size={72} />
        <div className="flex flex-col gap-1 text-[11px]">
          {elo != null && (
            <div className="flex items-center gap-1 text-chesscom-500">
              <Trophy className="h-3 w-3" />
              <span>Est. Elo</span>
              <span className="ml-auto font-mono font-semibold tabular-nums text-chesscom-900 dark:text-chesscom-100">{elo}</span>
            </div>
          )}
          {perf != null && perf !== elo && (
            <div className="flex items-center gap-1 text-chesscom-500">
              <span>Performance</span>
              <span className="ml-auto font-mono font-semibold tabular-nums text-chesscom-900 dark:text-chesscom-100">{perf}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhaseTile({ label, phase, userColor }: { label: string; phase: PhaseSplit['opening'] | PhaseSplit['middlegame'] | PhaseSplit['endgame']; userColor?: 'white' | 'black' | null }) {
  if (!phase) {
    return (
      <div className="rounded-lg bg-chesscom-100/50 p-2 text-center dark:bg-chesscom-800/50">
        <div className="text-[10px] uppercase tracking-wide text-chesscom-500">{label}</div>
        <div className="mt-1 font-mono text-sm text-chesscom-400">—</div>
      </div>
    );
  }
  const accUser = userColor === 'black' ? phase.accuracy_black : phase.accuracy_white;
  const accOther = userColor === 'black' ? phase.accuracy_white : phase.accuracy_black;
  return (
    <div className="rounded-lg bg-white p-2 text-center shadow-soft dark:bg-chesscom-800">
      <div className="text-[10px] uppercase tracking-wide text-chesscom-500">{label}</div>
      <div className="mt-1 font-mono text-base font-bold tabular-nums">{accUser.toFixed(1)}<span className="text-xs text-chesscom-400">%</span></div>
      <div className="text-[10px] text-chesscom-400">vs {accOther.toFixed(1)}%</div>
    </div>
  );
}

function countByCls(moves: AnalyzedMove[], side: 'white' | 'black'): Record<Classification, number> {
  const out = Object.fromEntries(Object.keys(CLASS_STYLE).map((k) => [k, 0])) as Record<Classification, number>;
  for (const m of moves) {
    const isWhite = m.ply % 2 === 1;
    if ((side === 'white') !== isWhite) continue;
    out[m.classification] = (out[m.classification] ?? 0) + 1;
  }
  return out;
}
