import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface Props {
  cp: number | null;       // white-perspective centipawns; null = even
  mate?: number | null;    // mate-in-N from white's POV (positive = white mates)
  orientation?: 'white' | 'black';
  /** Optional explicit height. If omitted, fills parent height (use with align-self: stretch). */
  height?: number;
}

// Convert centipawns to white's bar share [0, 1] using the same sigmoid as
// cpToWinPct in the server-side classifier (Lichess formula).
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

export default function EvalBar({ cp, mate, orientation = 'white', height }: Props) {
  const share = useMemo(() => {
    if (mate != null) return mate > 0 ? 1 : 0;
    return cpToShare(cp ?? 0);
  }, [cp, mate]);
  const whitePct = share * 100;
  const blackPct = 100 - whitePct;
  const whiteAdvantage = mate != null ? mate > 0 : (cp ?? 0) >= 0;
  const flip = orientation === 'black';
  const label = mate != null ? (mate > 0 ? `M${mate}` : `M${-mate}`) : fmtCp(cp);
  const isMate = mate != null;

  const wrapStyle: React.CSSProperties = height != null
    ? { height, width: 32 }
    : { width: 32, alignSelf: 'stretch' };

  // Smooth tween instead of spring — chess.com's bar feels glide-y, not bouncy.
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className="relative">
      <div
        className={`flex flex-col overflow-hidden rounded-md border border-ink-300 bg-ink-200 shadow-soft dark:border-ink-700 ${isMate ? 'shadow-glow' : ''}`}
        style={wrapStyle}
      >
        <motion.div
          className={`flex items-start justify-center text-[10px] font-semibold tabular-nums text-cream/90 ${
            isMate && !whiteAdvantage ? 'bg-bad' : 'bg-ink-900'
          }`}
          animate={{ height: `${flip ? whitePct : blackPct}%` }}
          transition={{ type: 'tween', duration: 0.28, ease }}
        />
        <motion.div
          className={`flex items-end justify-center text-[10px] font-semibold tabular-nums text-ink-900 ${
            isMate && whiteAdvantage ? 'bg-warn' : 'bg-cream'
          }`}
          animate={{ height: `${flip ? blackPct : whitePct}%` }}
          transition={{ type: 'tween', duration: 0.28, ease }}
        />
      </div>
      {/* Floating score chip on the advantaged side, outside the bar — pinned to
          the top or bottom depending on who's winning AND board orientation. */}
      <div
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow-soft ${
          whiteAdvantage
            ? 'bg-cream text-ink-900 ring-1 ring-ink-300'
            : 'bg-ink-900 text-cream ring-1 ring-ink-700'
        }`}
        style={{
          [whiteAdvantage === !flip ? 'bottom' : 'top']: 4,
        } as React.CSSProperties}
      >
        {label}
      </div>
    </div>
  );
}
