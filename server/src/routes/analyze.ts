import { Hono } from 'hono';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { StockfishEngine } from '../chess/stockfish.js';
import { classify, normalizeEval, cpToWinPct, moveAccuracy } from '../chess/classifier.js';
import type { AnalysisResult, AnalyzedMove, Color } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

const schema = z.object({
  game_id: z.number().int().positive(),
  depth: z.number().int().min(8).max(22).default(16),
  force: z.boolean().default(false),
});

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

  if (!force) {
    const existing = db.prepare('SELECT depth FROM analyses WHERE game_id = ?').get(game_id) as
      | { depth: number }
      | undefined;
    if (existing && existing.depth >= depth) {
      const cached = db.prepare('SELECT * FROM analyses WHERE game_id = ?').get(game_id) as {
        depth: number; accuracy_white: number; accuracy_black: number; moves_json: string;
      };
      return c.json({
        analysis: {
          depth: cached.depth,
          accuracy_white: cached.accuracy_white,
          accuracy_black: cached.accuracy_black,
          moves: JSON.parse(cached.moves_json),
        } satisfies AnalysisResult,
        cached: true,
      });
    }
  }

  const result = await analyzePgn(game.pgn, depth);

  db.prepare(`
    INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, moves_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(game_id) DO UPDATE SET depth = excluded.depth,
      accuracy_white = excluded.accuracy_white, accuracy_black = excluded.accuracy_black,
      moves_json = excluded.moves_json, created_at = datetime('now')
  `).run(game_id, depth, result.accuracy_white, result.accuracy_black, JSON.stringify(result.moves));

  return c.json({ analysis: result, cached: false });
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

  // Pre-evaluate starting position
  let prevEval = await engine.evaluate(replay.fen(), depth);
  let prevWhiteCp = normalizeEval(prevEval.cp, prevEval.mate, replay.turn());

  let whiteAccSum = 0, whiteAccN = 0;
  let blackAccSum = 0, blackAccN = 0;

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

    // Apply played move
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    const fenAfter = replay.fen();

    // Evaluate position after
    const nextEval = await engine.evaluate(fenAfter, depth);
    const nextWhiteCp = normalizeEval(nextEval.cp, nextEval.mate, replay.turn());

    const wpBefore = cpToWinPct(prevWhiteCp);
    const wpAfter = cpToWinPct(nextWhiteCp);

    // Per-move accuracy from this player's perspective
    const playerWinBefore = sideToMove === 'white' ? wpBefore : 100 - wpBefore;
    const playerWinAfter = sideToMove === 'white' ? wpAfter : 100 - wpAfter;
    const acc = moveAccuracy(playerWinBefore, playerWinAfter);
    if (sideToMove === 'white') { whiteAccSum += acc; whiteAccN++; } else { blackAccSum += acc; blackAccN++; }

    const cpLoss = Math.max(0, Math.round(playerWinBefore - playerWinAfter) * 4);
    const isBest = bestUci === move.from + move.to + (move.promotion ?? '');
    const cls = classify(cpLoss, isBest);

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

  engine.quit();

  return {
    depth,
    moves,
    accuracy_white: whiteAccN ? Math.round((whiteAccSum / whiteAccN) * 10) / 10 : 0,
    accuracy_black: blackAccN ? Math.round((blackAccSum / blackAccN) * 10) / 10 : 0,
  };
}

export default router;
