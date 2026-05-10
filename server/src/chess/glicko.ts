// Glicko-1 rating system, parameterized to match chess.com's online pool:
//   r0 = 1200, RD0 = 350 (capped), q = ln(10)/400, c ≈ 34.6 per period.
// Period = 1 game. Per-time-class pools (bullet/blitz/rapid/daily) are kept
// separate by the caller — this module is pool-agnostic.
//
// Public API:
//   inflateRd(rd, daysSinceLast) → RD with idle inflation applied
//   updateGlicko({ playerR, playerRd, opponentR, opponentRd, score })
//     → { newR, newRd, deltaR, deltaRd }
//
// Notes for future maintainers: Glicko-1 (NOT Glicko-2) is what chess.com
// uses; v2 adds a volatility parameter we don't need. The c value here is
// chosen so that an idle player's RD reinflates back to 350 over ~100 days,
// matching chess.com's reported behaviour.

const Q = Math.log(10) / 400; // 0.00575646273...
const PI_SQ = Math.PI * Math.PI;
const RD_MAX = 350;
const RD_MIN = 30;
// Per-period constant. With period = 1 game, an idle inflation of c²·days
// reinflates RD from ~50 back to 350 over ~100 idle days. 34.6 matches
// Glickman's classic worked example AND chess.com's empirical behaviour.
const C_SQ = 34.6 * 34.6;

export function gFunction(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / PI_SQ);
}

function expectedScore(playerR: number, opponentR: number, opponentRd: number): number {
  const g = gFunction(opponentRd);
  return 1 / (1 + Math.pow(10, (-g * (playerR - opponentR)) / 400));
}

/** Inflate RD to reflect idle time. `daysSinceLast` is wall-clock days since
 *  the player last played a rated game; pass 0 (or negative) to leave RD as-is.
 *  Caps at RD_MAX so a player who hasn't logged in for years can't have an RD
 *  larger than a brand-new account. */
export function inflateRd(rd: number, daysSinceLast: number): number {
  if (!Number.isFinite(rd) || rd <= 0) return RD_MAX;
  if (daysSinceLast <= 0) return Math.min(RD_MAX, rd);
  // Treat 1 game ≈ 1 period; for idle inflation we approximate periods = days.
  const inflated = Math.sqrt(rd * rd + C_SQ * daysSinceLast);
  return Math.min(RD_MAX, inflated);
}

export interface GlickoUpdate {
  newR: number;
  newRd: number;
  deltaR: number;
  deltaRd: number;
}

/** Update one player's rating after a single rated game.
 *  `score` is 1 (win), 0.5 (draw), 0 (loss) — from this player's perspective. */
export function updateGlicko(args: {
  playerR: number;
  playerRd: number;
  opponentR: number;
  opponentRd: number;
  score: 0 | 0.5 | 1;
}): GlickoUpdate {
  const { playerR, playerRd, opponentR, opponentRd, score } = args;
  const g = gFunction(opponentRd);
  const E = expectedScore(playerR, opponentR, opponentRd);
  // d² = 1 / (q²·g²·E·(1-E))
  const dSq = 1 / (Q * Q * g * g * E * (1 - E));
  const denom = 1 / (playerRd * playerRd) + 1 / dSq;
  const newR = playerR + (Q / denom) * g * (score - E);
  const newRd = Math.max(RD_MIN, Math.sqrt(1 / denom));
  return {
    newR,
    newRd,
    deltaR: newR - playerR,
    deltaRd: newRd - playerRd,
  };
}

/** Convenience: pair update for both sides of a single game. Returns the
 *  updated values for white and black using the *original* (pre-update) RDs
 *  for both — this is required by Glicko (do NOT chain updates within a single
 *  rating period). */
export function updatePair(args: {
  whiteR: number; whiteRd: number;
  blackR: number; blackRd: number;
  result: '1-0' | '0-1' | '1/2-1/2';
}): { white: GlickoUpdate; black: GlickoUpdate } {
  const wScore = args.result === '1-0' ? 1 : args.result === '1/2-1/2' ? 0.5 : 0;
  const bScore = (1 - wScore) as 0 | 0.5 | 1;
  const white = updateGlicko({
    playerR: args.whiteR, playerRd: args.whiteRd,
    opponentR: args.blackR, opponentRd: args.blackRd,
    score: wScore as 0 | 0.5 | 1,
  });
  const black = updateGlicko({
    playerR: args.blackR, playerRd: args.blackRd,
    opponentR: args.whiteR, opponentRd: args.whiteRd,
    score: bScore,
  });
  return { white, black };
}

export const GLICKO_DEFAULTS = { rating: 1200, rd: RD_MAX } as const;
export const PROVISIONAL_RD_THRESHOLD = 110; // RD above this → show rating with `?`
export const PROVISIONAL_GAMES = 10;          // games below this → also provisional
