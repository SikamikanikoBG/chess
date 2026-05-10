import { useMemo } from 'react';

interface Props {
  cp: number | null; // white-perspective centipawns; null = even
  orientation?: 'white' | 'black';
  /** Optional explicit height. If omitted, fills parent height (use with align-self: stretch). */
  height?: number;
}

// Convert centipawns to white's bar share [0, 1] using the same sigmoid
// as cpToWinPct in the server-side classifier (Lichess formula).
function cpToShare(cp: number): number {
  if (cp >= 9000) return 1;
  if (cp <= -9000) return 0;
  const v = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return Math.max(0.03, Math.min(0.97, 0.5 + 0.5 * v));
}

function fmtCp(cp: number | null): string {
  if (cp == null) return '0.0';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(1)}`;
}

export default function EvalBar({ cp, orientation = 'white', height }: Props) {
  const share = useMemo(() => cpToShare(cp ?? 0), [cp]);
  const whitePct = share * 100;
  const blackPct = 100 - whitePct;
  const whiteAdvantage = (cp ?? 0) >= 0;
  const flip = orientation === 'black';

  const wrapStyle: React.CSSProperties = height != null
    ? { height, width: 28 }
    : { width: 28, alignSelf: 'stretch' };

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-ink-300 bg-ink-200 shadow-soft" style={wrapStyle}>
      <div
        className="flex items-start justify-center bg-ink-900 text-[10px] font-semibold tabular-nums text-cream/90 transition-[height] duration-200 ease-out"
        style={{ height: `${flip ? whitePct : blackPct}%` }}
      >
        {!whiteAdvantage && <span className="mt-0.5">{fmtCp(cp)}</span>}
      </div>
      <div
        className="flex items-end justify-center bg-cream text-[10px] font-semibold tabular-nums text-ink-900 transition-[height] duration-200 ease-out"
        style={{ height: `${flip ? blackPct : whitePct}%` }}
      >
        {whiteAdvantage && <span className="mb-0.5">{fmtCp(cp)}</span>}
      </div>
    </div>
  );
}
