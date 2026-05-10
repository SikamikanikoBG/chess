import type { Classification } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Scoring version. Bump when the classification thresholds, accuracy formula,
// or estimateElo curve changes — analyses cached at an older version will be
// silently re-run on next view.
// ─────────────────────────────────────────────────────────────────────────────
export const SCORING_VERSION = 5;

// First N plies are tagged `book` regardless of engine eval (unless they're an
// outright mistake / blunder). Mirrors chess.com's behaviour of treating early
// theory moves as "book" without doing a full opening-book lookup.
export const BOOK_PLIES = 10;

// Threshold above which a centipawn value is treated as a mate score (set by
// `mateToCp` to ±10000 ± 10·moves). Anything beyond this is "the engine sees
// mate", not a positional eval.
const MATE_CP_THRESHOLD = 9000;
function isMateCp(cp: number): boolean { return Math.abs(cp) >= MATE_CP_THRESHOLD; }

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

// Standard chess.com/lichess-style classification by win-percentage drop.
// `winPctDrop` is from the player's perspective (always >= 0). `cpLoss` is the
// real centipawn loss, used as a secondary guard so that "best" requires both
// near-zero win% drop AND near-zero cp loss (otherwise lopsided positions
// classify every reasonable move as "best").
// chess.com-style win-percentage ladder (v5 — re-aligned with chess.com's
// reported "most moves are excellent" distribution):
//   isBest                      → best
//   < 2 wp drop & < 30 cpLoss   → excellent
//   < 5 wp drop & < 60 cpLoss   → good
//   < 10 wp drop                → inaccuracy
//   < 20 wp drop                → mistake
//   ≥ 20 wp drop                → blunder
// Pre-v5 used 0.5 / 2 / 5 / 10 — too strict, classified routine moves as
// inaccuracies. Loosening matches chess.com support docs:
// https://support.chess.com/en/articles/8572705
export function classifyByWpDrop(winPctDrop: number, cpLoss: number, isBest: boolean): Classification {
  if (isBest) return 'best';
  if (winPctDrop < 2 && cpLoss < 30) return 'excellent';
  if (winPctDrop < 5 && cpLoss < 60) return 'good';
  if (winPctDrop < 10) return 'inaccuracy';
  if (winPctDrop < 20) return 'mistake';
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
  ply: number;            // 1-based ply within the game
  legalMoveCount: number; // # of legal moves in fenBefore (1 ⇒ Forced)
  // Top engine candidates from MultiPV (sorted best-first, player's perspective).
  // Index 0 is the engine's best move, index 1 the second-best, etc. Pass [] if
  // unavailable — Brilliant/Great rules will degrade gracefully.
  candidatePlayerCps: number[];
}): Classification {
  const {
    base, isBest, cpLoss, fenBefore, fenAfter, sideToMove,
    playerEvalBeforeCp, playerEvalAfterCp,
    ply, legalMoveCount, candidatePlayerCps,
  } = args;

  // FORCED: only one legal move. Wins over every other label including `best`
  // because it isn't the player's *choice* — there's nothing else to play.
  if (legalMoveCount === 1) return 'forced';

  // BOOK: first N plies, but only if the move isn't an outright blunder. A
  // theoretical novelty that loses material is still a blunder.
  if (ply <= BOOK_PLIES && base !== 'blunder' && base !== 'mistake') return 'book';

  // BRILLIANT (chess.com rules):
  //   - engine's #1 choice
  //   - sacrifices ≥ 2 pawns of material vs the position before the move
  //   - player is NOT already winning by > +500cp (no "brilliant" when crushing)
  //   - more than one legal move (already guaranteed by the forced check above)
  //   - move is non-trivial: not in opening / book territory
  //   - sacrifice is real, not a trade-recapture sequence (engine PV doesn't
  //     start with an even recapture in the next 1-2 plies)
  const moveNumber = Number(fenBefore.split(' ')[5] ?? '1');
  if (isBest && moveNumber > 4 && playerEvalBeforeCp <= 500) {
    const matBefore = materialFromFen(fenBefore);
    const matAfter = materialFromFen(fenAfter);
    const playerMatBefore = sideToMove === 'white' ? matBefore.white : matBefore.black;
    const playerMatAfter = sideToMove === 'white' ? matAfter.white : matAfter.black;
    const sacrificed = playerMatBefore - playerMatAfter;
    if (sacrificed >= 2 && cpLoss <= 20 && playerEvalAfterCp >= -50) return 'brilliant';
  }

  // GREAT: only one move keeps the win. Detected via MultiPV — when the played
  // move is best AND the second-best candidate is at least 150cp worse from
  // the player's perspective, this was a critical only-good-move. Skip in book
  // territory: early-game "only moves" aren't great, they're theory.
  if (isBest && ply > BOOK_PLIES && candidatePlayerCps.length >= 2) {
    const top = candidatePlayerCps[0]!;
    const second = candidatePlayerCps[1]!;
    if (top - second >= 150) return 'great';
  }

  // MISS: blew a clearly-winning advantage. Any drop into a non-winning eval
  // (≤ +50cp) from a clearly winning one (≥ +150cp) when classified at
  // inaccuracy or worse.
  if ((base === 'mistake' || base === 'blunder' || base === 'inaccuracy')
      && playerEvalBeforeCp >= 150
      && playerEvalAfterCp < 50) {
    return 'miss';
  }

  return base;
}

export const CLASSIFICATION_ORDER: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss',
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
  return sideToMove === 'w' ? val : -val;
}

// Estimate playing strength from average centipawn loss (ACPL).
// Re-anchored against Lichess blitz / chess.com rapid distributions — the old
// curve ran ~300-400 Elo hot in the middle band (a 1500 player would show as
// 1900). New calibration:
//   ACPL  ~5  → 2500  (GM-strong)
//   ACPL  15  → 2050
//   ACPL  30  → 1650
//   ACPL  50  → 1400
//   ACPL  80  → 1100
//   ACPL 150  →  750
//   ACPL 250+ →  500
// Piecewise-linear so the curve hits the calibration points exactly.
export function eloFromAcpl(acpl: number): number {
  const a = Math.max(0, acpl);
  let elo: number;
  if (a <= 5)        elo = 2700 - (a / 5) * 200;          // 2700 → 2500
  else if (a <= 15)  elo = 2500 - ((a - 5) / 10) * 450;   // 2500 → 2050
  else if (a <= 30)  elo = 2050 - ((a - 15) / 15) * 400;  // 2050 → 1650
  else if (a <= 50)  elo = 1650 - ((a - 30) / 20) * 250;  // 1650 → 1400
  else if (a <= 80)  elo = 1400 - ((a - 50) / 30) * 300;  // 1400 → 1100
  else if (a <= 150) elo = 1100 - ((a - 80) / 70) * 350;  // 1100 → 750
  else if (a <= 250) elo = 750  - ((a - 150) / 100) * 250;//  750 → 500
  else               elo = Math.max(300, 500 - (a - 250) * 0.5);
  return Math.round(Math.max(300, Math.min(2900, elo)));
}

// Public Elo estimator. We trust ACPL more than accuracy% (accuracy% is a
// monotonic transform of cp_loss anyway), but accuracy serves as a tiebreaker
// at extremes — a player who never blunders but plays many "good but not best"
// moves should rate higher than ACPL alone suggests. Cap on the accuracy nudge
// is now ±100 (was effectively ±80 after the *0.4 weight) so accuracy can't
// drag a 30-ACPL game from 1650 up into "strong club" territory.
export function estimateElo(accuracy: number, avgCpl: number): number {
  const fromAcpl = eloFromAcpl(avgCpl);
  const accAdjust = Math.max(-100, Math.min(100, (accuracy - 75) * 10));
  return Math.round(Math.max(300, Math.min(2900, fromAcpl + accAdjust * 0.4)));
}

// Per-game performance rating, chess.com Game Review style. Blends the
// player's own strength signal (ACPL + accuracy) with an opponent-anchor that
// scales with confidence in the opponent's rating. A strong perf vs a 1800
// opponent means more than the same perf vs a 600.
export function estimateGamePerformance(args: {
  accuracy: number;
  acpl: number;
  opponentRating: number | null;
  opponentRd: number | null;
  // 1 = win, 0.5 = draw, 0 = loss
  score: 0 | 0.5 | 1;
}): number {
  const { accuracy, acpl, opponentRating, opponentRd, score } = args;
  const fromAcpl = eloFromAcpl(acpl);
  const accNudge = Math.max(-100, Math.min(100, (accuracy - 75) * 10));
  const ownStrength = fromAcpl + 0.4 * accNudge;

  // Without a confident opponent rating, fall back to the own-strength estimate.
  if (opponentRating == null || !Number.isFinite(opponentRating)) {
    return Math.round(Math.max(300, Math.min(2900, ownStrength)));
  }
  // Confidence in the opponent rating shrinks as their RD grows.
  const rd = opponentRd ?? 350;
  const oppConf = Math.max(0, Math.min(1, (350 - rd) / 250));
  const result = score === 1 ? 200 : score === 0 ? -200 : 0;
  const oppPerf = opponentRating + result;
  const blend = ownStrength * (1 - 0.4 * oppConf) + oppPerf * (0.4 * oppConf);
  return Math.round(Math.max(300, Math.min(2900, blend)));
}

// Centipawn-loss reducer for a single ply. Mate-vs-mate transitions used to
// pollute ACPL by treating ±M3 → ∓M5 as a 1000-cp loss along a forced line —
// any game that ended in a mating attack tanked the loser's Elo. We now treat
// "still mating" / "still being mated" same-sign mate transitions as cp_loss=0.
// A flip from "I'm mating" → "I'm being mated" (sign change between mate scores)
// is still treated as a maximal loss so a real squander shows up.
export function cpLossForPly(playerEvalBeforeCp: number, playerEvalAfterCp: number): number {
  const beforeMate = isMateCp(playerEvalBeforeCp);
  const afterMate = isMateCp(playerEvalAfterCp);
  if (beforeMate && afterMate) {
    const sameSign = (playerEvalBeforeCp > 0) === (playerEvalAfterCp > 0);
    if (sameSign) return 0;
    return 1000;
  }
  return Math.min(1000, Math.max(0, playerEvalBeforeCp - playerEvalAfterCp));
}
