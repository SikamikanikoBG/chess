import { Hono } from 'hono';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { StockfishEngine } from '../chess/stockfish.js';
import { classifyByWpDrop, refineClassification, normalizeEval, cpToWinPct, cpLossForPly, moveAccuracy, estimateElo, SCORING_VERSION } from '../chess/classifier.js';
import type { AnalysisResult, AnalyzedMove, Color } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

const schema = z.object({
  game_id: z.number().int().positive(),
  depth: z.number().int().min(8).max(22).default(16),
  force: z.boolean().default(false),
});

// Single-flight guard: only one analysis per user at a time. Without this, a
// double-click on "Analyze" — or two browser tabs — spawns two concurrent
// Stockfish processes against the same PGN, doubling CPU and racing inserts.
const inflight = new Map<number, Promise<unknown>>();

router.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, depth, force } = parsed.data;

  const game = db.prepare('SELECT pgn FROM games WHERE id = ? AND user_id = ?').get(game_id, user.id) as
    | { pgn: string }
    | undefined;
  if (!game) return c.json({ error: 'not_found' }, 404);

  if (inflight.has(user.id)) return c.json({ error: 'already_analyzing' }, 429);

  if (!force) {
    const existing = db.prepare('SELECT depth, scoring_version FROM analyses WHERE game_id = ?').get(game_id) as
      | { depth: number; scoring_version: number }
      | undefined;
    if (existing && existing.depth >= depth && existing.scoring_version >= SCORING_VERSION) {
      const cached = db.prepare('SELECT * FROM analyses WHERE game_id = ?').get(game_id) as {
        depth: number; accuracy_white: number; accuracy_black: number;
        estimated_elo_white: number | null; estimated_elo_black: number | null;
        moves_json: string;
      };
      return c.json({
        analysis: {
          depth: cached.depth,
          accuracy_white: cached.accuracy_white,
          accuracy_black: cached.accuracy_black,
          estimated_elo_white: cached.estimated_elo_white,
          estimated_elo_black: cached.estimated_elo_black,
          moves: JSON.parse(cached.moves_json),
        } satisfies AnalysisResult,
        cached: true,
      });
    }
  }

  const work = (async () => {
    const result = await analyzePgn(game.pgn, depth);
    db.prepare(`
      INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, estimated_elo_white, estimated_elo_black, moves_json, scoring_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET depth = excluded.depth,
        accuracy_white = excluded.accuracy_white, accuracy_black = excluded.accuracy_black,
        estimated_elo_white = excluded.estimated_elo_white, estimated_elo_black = excluded.estimated_elo_black,
        moves_json = excluded.moves_json, scoring_version = excluded.scoring_version,
        created_at = datetime('now')
    `).run(game_id, depth, result.accuracy_white, result.accuracy_black, result.estimated_elo_white, result.estimated_elo_black, JSON.stringify(result.moves), SCORING_VERSION);
    return result;
  })();

  inflight.set(user.id, work);
  try {
    const result = await work;
    return c.json({ analysis: result, cached: false });
  } finally {
    inflight.delete(user.id);
  }
});

export async function analyzePgn(pgn: string, depth: number): Promise<AnalysisResult> {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const history = chess.history({ verbose: true });

  const engine = new StockfishEngine();
  await engine.start();
  await engine.setOption('Skill Level', 20);
  await engine.setOption('Threads', '2');
  await engine.setOption('Hash', '128');

  // Replay through positions
  const replay = new Chess();
  const moves: AnalyzedMove[] = [];

  // Pre-evaluate starting position with MultiPV=3 so we can detect "Great"
  // (only-good-move) and gap-aware "Brilliant" via the second-best candidate.
  let prevEval = await engine.evaluateMulti(replay.fen(), depth, 3);
  let prevWhiteCp = normalizeEval(prevEval.cp, prevEval.mate, replay.turn());

  let whiteAccSum = 0, whiteAccN = 0, whiteCplSum = 0;
  let blackAccSum = 0, blackAccN = 0, blackCplSum = 0;

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    if (!move) continue;
    const sideToMove: Color = replay.turn() === 'w' ? 'white' : 'black';
    const fenBefore = replay.fen();
    const bestUci = prevEval.bestMoveUci;

    // Convert best uci to san for display
    let bestSan: string | null = null;
    if (bestUci) {
      const probe = new Chess(fenBefore);
      const m = probe.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined });
      if (m) bestSan = m.san;
    }

    // Build PV in SAN for display (first 6 moves)
    const pvSan: string[] = [];
    if (prevEval.pv.length) {
      const pvProbe = new Chess(fenBefore);
      for (const u of prevEval.pv.slice(0, 6)) {
        const m = pvProbe.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
        if (!m) break;
        pvSan.push(m.san);
      }
    }

    // Count legal moves BEFORE applying the played move so we can detect Forced.
    const legalMoveCount = new Chess(fenBefore).moves().length;

    // Build the candidate list from this player's perspective. prevEval was
    // computed for fenBefore, so each candidate's cp/mate is from side-to-move
    // (== this player) directly.
    const candidatePlayerCps: number[] = prevEval.candidates.map((cand) => {
      if (cand.mate !== null) return cand.mate > 0 ? 10000 - cand.mate * 10 : -10000 - cand.mate * 10;
      return cand.cp ?? 0;
    });

    // Apply played move
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    const fenAfter = replay.fen();

    // Evaluate position after — keep MultiPV so the next iteration's prevEval
    // has candidates ready for that ply's refinement.
    const nextEval = await engine.evaluateMulti(fenAfter, depth, 3);
    const nextWhiteCp = normalizeEval(nextEval.cp, nextEval.mate, replay.turn());

    const wpBefore = cpToWinPct(prevWhiteCp);
    const wpAfter = cpToWinPct(nextWhiteCp);

    // Per-move accuracy and cp_loss from this player's perspective
    const playerWinBefore = sideToMove === 'white' ? wpBefore : 100 - wpBefore;
    const playerWinAfter = sideToMove === 'white' ? wpAfter : 100 - wpAfter;
    const acc = moveAccuracy(playerWinBefore, playerWinAfter);

    const playerEvalBeforeCp = sideToMove === 'white' ? prevWhiteCp : -prevWhiteCp;
    const playerEvalAfterCp = sideToMove === 'white' ? nextWhiteCp : -nextWhiteCp;
    // Mate-aware centipawn loss — see cpLossForPly. Plain cp diff would treat
    // a forced ±M3 → ∓M5 line as a 1000-cp blunder per ply, polluting ACPL.
    const cpLoss = cpLossForPly(playerEvalBeforeCp, playerEvalAfterCp);
    const wpDrop = Math.max(0, playerWinBefore - playerWinAfter);
    const isBest = bestUci === move.from + move.to + (move.promotion ?? '');
    const baseCls = classifyByWpDrop(wpDrop, cpLoss, isBest);
    const cls = refineClassification({
      base: baseCls,
      isBest,
      cpLoss,
      fenBefore,
      fenAfter,
      sideToMove,
      playerEvalBeforeCp,
      playerEvalAfterCp,
      ply: i + 1,
      legalMoveCount,
      candidatePlayerCps,
    });

    if (sideToMove === 'white') {
      whiteAccSum += acc; whiteAccN++; whiteCplSum += cpLoss;
    } else {
      blackAccSum += acc; blackAccN++; blackCplSum += cpLoss;
    }

    moves.push({
      ply: i + 1,
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ''),
      fen_before: fenBefore,
      fen_after: fenAfter,
      eval_before_cp: prevWhiteCp,
      eval_after_cp: nextWhiteCp,
      best_move_uci: bestUci,
      best_move_san: bestSan,
      best_pv: pvSan,
      centipawn_loss: cpLoss,
      classification: cls,
    });

    prevEval = nextEval;
    prevWhiteCp = nextWhiteCp;
  }

  await engine.quit();

  const accuracy_white = whiteAccN ? Math.round((whiteAccSum / whiteAccN) * 10) / 10 : 0;
  const accuracy_black = blackAccN ? Math.round((blackAccSum / blackAccN) * 10) / 10 : 0;
  const acplWhite = whiteAccN ? whiteCplSum / whiteAccN : 0;
  const acplBlack = blackAccN ? blackCplSum / blackAccN : 0;

  return {
    depth,
    moves,
    accuracy_white,
    accuracy_black,
    estimated_elo_white: whiteAccN ? estimateElo(accuracy_white, acplWhite) : null,
    estimated_elo_black: blackAccN ? estimateElo(accuracy_black, acplBlack) : null,
  };
}

export default router;
