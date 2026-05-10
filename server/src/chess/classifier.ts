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

// Classify by centipawn loss (lower = better). Brilliant/Miss are applied as
// overrides in `refineClassification` after material/eval context is known.
export function classify(cpLoss: number, isBest: boolean): Classification {
  if (isBest) return 'best';
  if (cpLoss <= 10) return 'best';
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 250) return 'mistake';
  return 'blunder';
}

// Compute material totals (in pawn-equivalents) for both sides from a FEN.
// Excludes king (uncountable). Returns { white, black } scores.
export function materialFromFen(fen: string): { white: number; black: number } {
  const board = fen.split(' ')[0] ?? '';
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let white = 0;
  let black = 0;
  for (const ch of board) {
    if (ch === '/' || /\d/.test(ch)) continue;
    const v = values[ch.toLowerCase()];
    if (!v) continue;
    if (ch === ch.toLowerCase()) black += v;
    else white += v;
  }
  return { white, black };
}

// After the basic classification, upgrade to Brilliant or downgrade to Miss
// based on context. `playerEvalAfterCp` is from THIS player's perspective.
export function refineClassification(args: {
  base: Classification;
  isBest: boolean;
  cpLoss: number;
  fenBefore: string;
  fenAfter: string;
  sideToMove: 'white' | 'black';
  playerEvalBeforeCp: number;
  playerEvalAfterCp: number;
}): Classification {
  const { base, isBest, cpLoss, fenBefore, fenAfter, sideToMove, playerEvalBeforeCp, playerEvalAfterCp } = args;

  // BRILLIANT: engine's top choice that sacrifices material but the position
  // still holds (or is winning). Skip very early-game where book theory dominates.
  const moveNumber = Number(fenBefore.split(' ')[5] ?? '1');
  if ((isBest || cpLoss <= 10) && moveNumber > 4) {
    const matBefore = materialFromFen(fenBefore);
    const matAfter = materialFromFen(fenAfter);
    const playerMatBefore = sideToMove === 'white' ? matBefore.white : matBefore.black;
    const playerMatAfter = sideToMove === 'white' ? matAfter.white : matAfter.black;
    const sacrificed = playerMatBefore - playerMatAfter;
    if (sacrificed >= 3 && playerEvalAfterCp >= -50) return 'brilliant';
  }

  // MISS: a mistake or blunder in a position where the player was clearly winning.
  // Threshold: had >= +200cp, dropped by >= 100cp.
  if ((base === 'mistake' || base === 'blunder') && playerEvalBeforeCp >= 200) {
    return 'miss';
  }

  return base;
}

// Classification weights for scoring/sorting — useful in stats display.
export const CLASSIFICATION_ORDER: Classification[] = [
  'brilliant', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'miss',
];

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

// Approximate Elo for a single game from accuracy% and average centipawn loss.
// Two heuristics that disagree at extremes are averaged for stability.
// Calibrated loosely against Lichess game data — a one-game estimate is noisy,
// so this is meant as "ballpark playing strength for THIS particular game".
export function estimateElo(accuracy: number, avgCpl: number): number {
  const fromAcc = 400 + (accuracy - 50) * 38;
  const fromCpl = 2800 / (1 + (Math.max(0, avgCpl) / 50));
  const elo = (fromAcc + fromCpl) / 2;
  return Math.round(Math.max(400, Math.min(2800, elo)));
}
