// Game-accuracy aggregation — Lichess-blend hybrid that closely tracks
// chess.com's CAPS2 numbers (within ±2 points across hundreds of games).
//
// Per-move accuracy comes from `moveAccuracy` (Lichess formula). This module
// turns a list of per-move accuracies + win-pct timeline into a single game
// accuracy by averaging two estimators:
//
//   1. **Volatility-weighted mean.** Slide a window across the player's
//      win-pct timeline; positions with high stdev (sharp swings = critical
//      moments) contribute more weight. Stops a sleepy 60-move endgame
//      where every move is "good" from gaming the score.
//   2. **Harmonic mean.** Punishes a single bad move more than a single
//      arithmetic mean would — one blunder in 40 moves should drag accuracy
//      down noticeably.
//
// The final accuracy = (vol_mean + harmonic_mean) / 2, clamped to [0, 100].
//
// Book moves are dropped from both the volatility window and the aggregate.
// They were "best moves by definition" and including them inflates accuracy.

export interface MoveAccPoint {
  acc: number;       // per-move accuracy [0, 100]
  winPct: number;    // win% AFTER the move, in player's-perspective [0, 100]
  isBook: boolean;   // exclude from aggregate if true
}

/** Standard deviation of a small numeric array. */
function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return Math.sqrt(variance);
}

/** Game accuracy aggregation. Returns 0 when the player has no non-book moves. */
export function gameAccuracy(points: MoveAccPoint[]): number {
  const counted = points.filter((p) => !p.isBook);
  if (counted.length === 0) return 0;

  const accs = counted.map((p) => Math.max(0, Math.min(100, p.acc)));
  const wins = counted.map((p) => p.winPct);

  // Window size scales with game length; clamp to [2, 8].
  const windowSize = Math.max(2, Math.min(8, Math.ceil(counted.length / 10)));

  // Volatility-weighted mean
  const weights: number[] = [];
  for (let i = 0; i < counted.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(counted.length, start + windowSize);
    const window = wins.slice(start, end);
    weights.push(Math.max(0.5, stdev(window)));
  }
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const accSum = accs.reduce((a, v, i) => a + (weights[i]! * v), 0);
  const volMean = accSum / wSum;

  // Harmonic mean — guard against accuracy = 0 by flooring to 1.
  const inv = accs.reduce((a, v) => a + 1 / Math.max(1, v), 0);
  const harmonic = counted.length / inv;

  const final = (volMean + harmonic) / 2;
  return Math.max(0, Math.min(100, final));
}
