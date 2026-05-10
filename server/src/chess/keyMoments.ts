// Key moments detector — picks the 3–5 highest-impact plies for a "Game Report"
// summary. Score combines win-percentage swing with a classification weight, so
// a routine -200cp drop early in a winning position rates lower than a
// blunder-out-of-equal that flips evaluation.

import type { AnalyzedMove, Classification } from '../types.js';
import { cpToWinPct } from './classifier.js';

const CLASS_WEIGHT: Partial<Record<Classification, number>> = {
  blunder: 8,
  miss: 7,
  brilliant: 6,
  great: 5,
  mistake: 4,
  inaccuracy: 1.5,
};

export interface KeyMoment {
  ply: number;
  side: 'white' | 'black';
  san: string;
  fen_before: string;
  fen_after: string;
  classification: Classification;
  cp_loss: number;
  win_pct_delta: number; // absolute drop in player's win%, [0, 100]
  best_san: string | null;
  best_pv: string[];
  score: number; // internal ranking score (higher = more pivotal)
}

export function extractKeyMoments(moves: AnalyzedMove[], max = 5): KeyMoment[] {
  const candidates: KeyMoment[] = [];
  for (const m of moves) {
    const weight = CLASS_WEIGHT[m.classification];
    if (!weight) continue;
    const side: 'white' | 'black' = m.ply % 2 === 1 ? 'white' : 'black';
    const wpBeforeWhite = cpToWinPct(m.eval_before_cp ?? 0);
    const wpAfterWhite = cpToWinPct(m.eval_after_cp ?? 0);
    const wpBefore = side === 'white' ? wpBeforeWhite : 100 - wpBeforeWhite;
    const wpAfter = side === 'white' ? wpAfterWhite : 100 - wpAfterWhite;
    const delta = Math.abs(wpBefore - wpAfter);
    const score = m.centipawn_loss + 60 * weight;
    candidates.push({
      ply: m.ply,
      side,
      san: m.san,
      fen_before: m.fen_before,
      fen_after: m.fen_after,
      classification: m.classification,
      cp_loss: m.centipawn_loss,
      win_pct_delta: delta,
      best_san: m.best_move_san,
      best_pv: m.best_pv,
      score,
    });
  }

  // Sort by score desc; deduplicate near-adjacent plies (within 2) keeping the higher.
  candidates.sort((a, b) => b.score - a.score);
  const picked: KeyMoment[] = [];
  for (const c of candidates) {
    if (picked.some((p) => Math.abs(p.ply - c.ply) <= 2)) continue;
    picked.push(c);
    if (picked.length >= max) break;
  }
  picked.sort((a, b) => a.ply - b.ply);
  return picked;
}
