import { cn } from '../lib/utils';
import { styleFor, GLYPH_SVG } from '../lib/classification';

interface Props {
  classification: string;
  square: string;       // e.g. "e4"
  orientation?: 'white' | 'black';
  size?: 'sm' | 'md';
}

// Floating pictogram badge anchored to the corner of a board square. Must be
// placed inside a position:relative parent that's exactly the size of the
// chessboard. The badge hangs slightly above and to the right of the square so
// it doesn't obscure the piece silhouette underneath.
export default function ClassificationBadge({ classification, square, orientation = 'white', size = 'md' }: Props) {
  const style = styleFor(classification);
  if (!style) return null;
  if (square.length < 2) return null;

  const file = square.charCodeAt(0) - 97;        // a=0..h=7
  const rank = parseInt(square[1]!, 10) - 1;     // 1=0..8=7
  if (Number.isNaN(file) || Number.isNaN(rank)) return null;

  const flip = orientation === 'black';
  const colPct = (flip ? 7 - file : file) * 12.5;
  const rowPct = (flip ? rank : 7 - rank) * 12.5;

  const px = size === 'sm' ? 22 : 30;
  const left = `calc(${colPct}% + 12.5% - ${px * 0.65}px)`;
  const top  = `calc(${rowPct}% - ${px * 0.35}px)`;

  return (
    <div className="pointer-events-none absolute z-10 animate-fade-in" style={{ left, top }}>
      <div
        className={cn(
          'flex items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white/80 dark:ring-ink-900/80',
          style.bgClass,
        )}
        style={{ width: px, height: px }}
        title={classification}
      >
        <svg viewBox="0 0 24 24" width={px * 0.7} height={px * 0.7} aria-hidden="true">
          {GLYPH_SVG[style.glyph]}
        </svg>
      </div>
    </div>
  );
}
