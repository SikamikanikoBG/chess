import type { Classification } from '../types.js';

// Convert centipawn score (from white's perspective) to white's win percentage [0, 100].
// Lichess formula: winPct = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
export function cpToWinPct(cp: number): number {
  const v = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return 50 + 50 * v;
}

// Lichess accuracy formula: 103.1668 * exp(-0.04354 * delta) - 3.1669
// where delta = winPctBefore - winPctAfter (from the player's perspective).
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const delta = Math.max(0, winBefore - winAfter);
  const acc = 103.1668 * Math.exp(-0.04354 * delta) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

// Classify by centipawn loss (lower = better).
export function classify(cpLoss: number, isBest: boolean): Classification {
  if (isBest) return 'best';
  if (cpLoss <= 10) return 'best';
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 250) return 'mistake';
  return 'blunder';
}

// Convert mate score to a large centipawn equivalent for comparisons.
// Use ±10000 - 10*moves so closer mates dominate.
export function mateToCp(mate: number): number {
  if (mate > 0) return 10000 - mate * 10;
  return -10000 - mate * 10;
}

// Resolve an engine eval into a single white-perspective centipawn number.
// `sideToMove` is the side about to move in the position the eval was for.
export function normalizeEval(
  cp: number | null,
  mate: number | null,
  sideToMove: 'w' | 'b',
): number {
  let val: number;
  if (mate !== null) val = mateToCp(mate);
  else if (cp !== null) val = cp;
  else val = 0;
  // Engine reports from side-to-move's perspective; flip to white's perspective.
  return sideToMove === 'w' ? val : -val;
}
