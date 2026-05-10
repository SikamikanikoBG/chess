// Patzer wordmark + glyph. The glyph is a stylised knight head sitting inside
// a rounded square (a nod to the "your chess in a Docker container" pitch).
// Two-tone: amber ink on the brand surface. Render at any size; stroke widths
// are normalised to 24-unit grid.
//
// Usage:
//   <LogoMark size={32} />
//   <LogoLockup size={32} />   // mark + wordmark side by side
import { cn } from '../lib/utils';

interface MarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 28, className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label="Patzer"
      className={cn('shrink-0', className)}
    >
      {/* Container square */}
      <rect x="1" y="1" width="22" height="22" rx="5" className="fill-ink-900 dark:fill-cream" />
      {/* Subtle "rack" shadow strip */}
      <rect x="3" y="19" width="18" height="2" rx="1" className="fill-ink-700 dark:fill-ink-300" opacity="0.5" />
      {/* Knight silhouette — minimal, monoline-friendly */}
      <path
        d="M9.2 5.5 c -0.6 0 -1.1 0.4 -1.4 1 l -0.7 1.6 c -0.1 0.3 -0.4 0.5 -0.7 0.5 H 5 c -0.5 0 -0.9 0.4 -0.9 0.9 v 1.8 c 0 0.4 0.3 0.7 0.7 0.7 H 6 l -0.4 1.5 c -0.2 0.7 0.2 1.4 0.9 1.6 l 0.7 0.2 c 0.6 0.1 1.2 -0.2 1.5 -0.7 l 0.5 -0.9 V 18 h 9 v -3.5 c 0 -3.6 -1.6 -6.4 -4.4 -8.1 l -0.6 -0.4 c -0.5 -0.3 -1.1 -0.5 -1.7 -0.5 H 9.2 z M 14.8 8.5 a 0.7 0.7 0 1 1 0 1.4 a 0.7 0.7 0 0 1 0 -1.4 z"
        className="fill-amber-400 dark:fill-amber-500"
      />
    </svg>
  );
}

interface LockupProps extends MarkProps {
  /** Render only the wordmark text class, no <svg>. Useful for inline contexts. */
  wordmarkOnly?: boolean;
}

export function LogoLockup({ size = 28, className, wordmarkOnly }: LockupProps) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      {!wordmarkOnly && <LogoMark size={size} />}
      <span
        className="font-semibold tracking-tight text-ink-900 dark:text-cream"
        style={{ fontSize: Math.round(size * 0.62) }}
      >
        Patzer
      </span>
    </span>
  );
}
