import { useMemo } from 'react';
import { styleFor } from '../lib/classification';

interface Eval { ply: number; cp: number | null }
interface Mistake { ply: number; classification: string }

interface Props {
  evals: Eval[];
  current?: number;
  onClick?: (ply: number) => void;
  /** Plies where blunders/mistakes/inaccuracies happened, drawn as colored dots. */
  markers?: Mistake[];
  /** Pixel height; defaults to 144 (h-36) which gives the graph room to breathe. */
  height?: number;
}

// Same sigmoid the classifier uses server-side (Lichess formula). White's
// share of the bar in [0, 1].
function cpToWinShare(cp: number): number {
  if (cp >= 9000) return 1;
  if (cp <= -9000) return 0;
  const v = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return Math.max(0.03, Math.min(0.97, 0.5 + 0.5 * v));
}

function fmtCp(cp: number | null): string {
  if (cp == null) return '0.0';
  // The classifier encodes mate as ±10000 - 10·moves (see mateToCp). Decode
  // back to a human-friendly `M{n}` so the eval pill in the analyzer doesn't
  // flatten "mate in 3" to a generic "#".
  if (cp >= 9000) {
    const moves = Math.max(1, Math.round((10000 - cp) / 10));
    return `M${moves}`;
  }
  if (cp <= -9000) {
    const moves = Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
    return `-M${moves}`;
  }
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

// Hand-rolled SVG eval graph — Lichess-style filled area showing win-share for
// white above the midline, black below. We don't use Recharts here: the chart
// is small, doesn't need axes, and rendering it ourselves shaves ~80 KB off the
// bundle and lets us draw in win-percent space rather than clamped centipawns.
export default function EvalGraph({ evals, current, onClick, markers = [], height = 144 }: Props) {
  const points = useMemo(() => {
    if (!evals.length) return [] as Array<{ x: number; y: number; share: number; cp: number; ply: number }>;
    const w = 100;
    const dx = evals.length > 1 ? w / (evals.length - 1) : w;
    return evals.map((e, i) => {
      const cp = e.cp ?? 0;
      const share = cpToWinShare(cp);
      return { x: i * dx, y: (1 - share) * 100, share, cp, ply: e.ply };
    });
  }, [evals]);

  if (!points.length) {
    return <div style={{ height }} className="grid w-full place-items-center text-xs text-ink-400">No evaluation yet</div>;
  }

  // Build the area path: line across the data, then close along the bottom.
  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const lastX = points[points.length - 1]!.x.toFixed(2);
  const firstX = points[0]!.x.toFixed(2);
  const blackArea = `${linePath} L${lastX},100 L${firstX},100 Z`;
  const whiteArea = `${linePath} L${lastX},0 L${firstX},0 Z`;

  function pickPly(clientX: number, rect: DOMRect): number {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (evals.length - 1));
    return evals[idx]?.ply ?? evals[0]!.ply;
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block h-full w-full cursor-crosshair"
        onClick={(e) => {
          if (!onClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onClick(pickPly(e.clientX, rect));
        }}
      >
        {/* White's territory (above midline) — slightly muted in dark mode so
            it doesn't punch out of the page. */}
        <path d={whiteArea} className="fill-cream opacity-95 dark:fill-ink-300/90" />
        {/* Black's territory */}
        <path d={blackArea} className="fill-ink-900 opacity-95 dark:fill-ink-950" />
        {/* Midline */}
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(100,116,139,0.5)" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
        {/* Eval line — slate so it reads against both halves */}
        <path d={linePath} fill="none" stroke="#64748b" strokeWidth="0.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {/* Mistake / blunder / brilliancy markers — color comes from the shared
            classification table so the graph and the move-list agree. */}
        {markers.map((m) => {
          const idx = m.ply - 1;
          const p = points[idx];
          if (!p) return null;
          const s = styleFor(m.classification);
          if (!s) return null;
          return (
            <circle
              key={m.ply}
              cx={p.x}
              cy={p.y}
              r="2"
              fill={s.hex}
              stroke="#fff"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* Current-ply scrubber */}
        {current !== undefined && (() => {
          const p = points[current - 1] ?? points[0];
          if (!p) return null;
          return (
            <g>
              <line x1={p.x} y1={0} x2={p.x} y2={100} stroke="#10b981" strokeWidth="0.4" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
              <circle cx={p.x} cy={p.y} r="2" fill="#10b981" stroke="#fff" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })()}
      </svg>
      {/* Pawn-unit Y-axis labels — moved to LEFT (chess.com convention) */}
      <div className="pointer-events-none absolute inset-y-1 left-1 flex flex-col justify-between text-[9px] font-medium tabular-nums text-ink-400">
        <span>+5</span>
        <span>0</span>
        <span>−5</span>
      </div>
      {/* Current eval pill */}
      {current !== undefined && points[current - 1] && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-ink-900/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-cream backdrop-blur-sm dark:bg-cream/80 dark:text-ink-900">
          {fmtCp(points[current - 1]!.cp)}
        </div>
      )}
    </div>
  );
}
