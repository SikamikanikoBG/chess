// Insights — per-user mistake-pattern aggregation across recent analyzed games.
// All headlines are templated (no LLM) so the page renders instantly.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import type { AnalyzedMove, Classification, GamePhase, PhaseSplit } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface AnalysisRow {
  game_id: number;
  user_color: 'white' | 'black' | null;
  moves_json: string;
  phase_split_json: string | null;
}

interface PhaseAcc { count: number; pos: number }

router.get('/', (c) => {
  const me = c.get('user');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, a.moves_json, a.phase_split_json
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ORDER BY g.end_time DESC, g.id DESC
    LIMIT ?
  `).all(me.id, SCORING_VERSION, limit) as AnalysisRow[];

  if (rows.length === 0) {
    return c.json({ games_analyzed: 0, weak_spots: [], phase_accuracy: { opening: 0, middlegame: 0, endgame: 0 } });
  }

  // Aggregate per (phase, classification, user-side only)
  const phaseStats: Record<GamePhase, Record<Classification, number>> = {
    opening: emptyClassMap(), middlegame: emptyClassMap(), endgame: emptyClassMap(),
  };
  // Phase accuracy roll-up
  const phaseAcc: Record<GamePhase, PhaseAcc> = {
    opening: { count: 0, pos: 0 }, middlegame: { count: 0, pos: 0 }, endgame: { count: 0, pos: 0 },
  };
  let backRankCount = 0;
  let hungPiecesCount = 0;
  let timePressureBlunders = 0;

  for (const r of rows) {
    const moves = JSON.parse(r.moves_json) as AnalyzedMove[];
    const split = r.phase_split_json ? (JSON.parse(r.phase_split_json) as PhaseSplit) : null;
    const userColor = r.user_color ?? 'white';

    if (split?.opening) {
      const acc = userColor === 'white' ? split.opening.accuracy_white : split.opening.accuracy_black;
      phaseAcc.opening.pos += acc; phaseAcc.opening.count++;
    }
    if (split?.middlegame) {
      const acc = userColor === 'white' ? split.middlegame.accuracy_white : split.middlegame.accuracy_black;
      phaseAcc.middlegame.pos += acc; phaseAcc.middlegame.count++;
    }
    if (split?.endgame) {
      const acc = userColor === 'white' ? split.endgame.accuracy_white : split.endgame.accuracy_black;
      phaseAcc.endgame.pos += acc; phaseAcc.endgame.count++;
    }

    for (const m of moves) {
      const side = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== userColor) continue;
      const phase = phaseFor(m.ply, split);
      phaseStats[phase][m.classification]++;
      // Hung pieces: cp_loss ≥ 200 (a piece + change worth)
      if (m.centipawn_loss >= 200) hungPiecesCount++;
      // Back-rank pattern: blunder where the played FEN has the king on rank 1 (white) or 8 (black) AND no pieces on rank 1/8 except king to break a back-rank weakness signature.
      if (m.classification === 'blunder' && hasBackRankSignature(m.fen_after, userColor)) backRankCount++;
    }
  }

  const totalUserMoves = sumClassMap(phaseStats.opening) + sumClassMap(phaseStats.middlegame) + sumClassMap(phaseStats.endgame);
  const weak: { key: string; count: number; pct: number; headline_en: string; headline_bg: string }[] = [];

  // Endgame inaccuracy / mistake / blunder rate
  {
    const endgameBad = phaseStats.endgame.inaccuracy + phaseStats.endgame.mistake + phaseStats.endgame.blunder + phaseStats.endgame.miss;
    const endgameTotal = sumClassMap(phaseStats.endgame);
    if (endgameTotal >= 10) {
      const pct = endgameBad / endgameTotal;
      if (pct >= 0.15) {
        weak.push({
          key: 'endgame_mistakes', count: endgameBad, pct,
          headline_en: `You lose accuracy in endgames — ${Math.round(pct * 100)}% of endgame moves are inaccurate or worse.`,
          headline_bg: `Губиш точност в ендшпила — ${Math.round(pct * 100)}% от ходовете там са неточни или по-лоши.`,
        });
      }
    }
  }
  // Hung pieces
  if (hungPiecesCount >= 5) {
    const pct = hungPiecesCount / Math.max(1, totalUserMoves);
    weak.push({
      key: 'hung_pieces', count: hungPiecesCount, pct,
      headline_en: `Hung pieces remain your most expensive habit — ${hungPiecesCount} moves lost ≥2 pawns of material.`,
      headline_bg: `Висящите фигури са скъпият ти навик — в ${hungPiecesCount} хода загуби ≥2 пешки материал.`,
    });
  }
  // Back-rank
  if (backRankCount >= 3) {
    weak.push({
      key: 'back_rank', count: backRankCount, pct: backRankCount / Math.max(1, totalUserMoves),
      headline_en: `Back-rank weaknesses catch you out — ${backRankCount} blunders had a back-rank signature.`,
      headline_bg: `Слабостта на последния хор е твой капан — ${backRankCount} блъндера са с такъв подпис.`,
    });
  }
  // Opening blunders early
  {
    const openingBlunders = phaseStats.opening.blunder + phaseStats.opening.mistake;
    const openingTotal = sumClassMap(phaseStats.opening);
    if (openingTotal >= 8 && openingBlunders / Math.max(1, openingTotal) >= 0.10) {
      weak.push({
        key: 'opening_pitfalls', count: openingBlunders, pct: openingBlunders / openingTotal,
        headline_en: `Your openings leak — ${openingBlunders} mistakes/blunders before move 15.`,
        headline_bg: `Дебютите ти текат — ${openingBlunders} грешки/блъндъра преди 15-и ход.`,
      });
    }
  }
  // Time pressure (placeholder — clock data not yet on AnalyzedMove)
  void timePressureBlunders;

  weak.sort((a, b) => b.count - a.count);

  return c.json({
    games_analyzed: rows.length,
    weak_spots: weak.slice(0, 4),
    phase_accuracy: {
      opening: phaseAcc.opening.count ? Math.round((phaseAcc.opening.pos / phaseAcc.opening.count) * 10) / 10 : 0,
      middlegame: phaseAcc.middlegame.count ? Math.round((phaseAcc.middlegame.pos / phaseAcc.middlegame.count) * 10) / 10 : 0,
      endgame: phaseAcc.endgame.count ? Math.round((phaseAcc.endgame.pos / phaseAcc.endgame.count) * 10) / 10 : 0,
    },
  });
});

function emptyClassMap(): Record<Classification, number> {
  return {
    brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, forced: 0,
    inaccuracy: 0, mistake: 0, blunder: 0, miss: 0,
  };
}

function sumClassMap(m: Record<Classification, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}

function phaseFor(ply: number, split: PhaseSplit | null): GamePhase {
  if (!split) return ply <= 14 ? 'opening' : ply <= 40 ? 'middlegame' : 'endgame';
  if (split.opening && ply >= split.opening.from_ply && ply <= split.opening.to_ply) return 'opening';
  if (split.endgame && ply >= split.endgame.from_ply && ply <= split.endgame.to_ply) return 'endgame';
  return 'middlegame';
}

function hasBackRankSignature(fen: string, userColor: 'white' | 'black'): boolean {
  // Cheap heuristic: in `fen`, the user's king is on its back rank AND there
  // are no friendly pieces on the back rank to defend it (excluding the king).
  // Doesn't try to be perfect — feeds into "≥3 of these" before surfacing.
  const board = fen.split(' ')[0] ?? '';
  const ranks = board.split('/');
  const backRank = userColor === 'white' ? ranks[7] : ranks[0];
  if (!backRank) return false;
  const target = userColor === 'white' ? 'K' : 'k';
  if (!backRank.includes(target)) return false;
  let nonKing = 0;
  for (const ch of backRank) {
    if (/\d/.test(ch)) continue;
    if (ch !== target && ((userColor === 'white' && ch === ch.toUpperCase()) || (userColor === 'black' && ch === ch.toLowerCase()))) {
      nonKing++;
    }
  }
  return nonKing === 0;
}

export default router;
