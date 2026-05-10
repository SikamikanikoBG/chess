// Rating endpoints — exposes per-time-class Glicko ratings + history.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { GLICKO_DEFAULTS, PROVISIONAL_RD_THRESHOLD, PROVISIONAL_GAMES } from '../chess/glicko.js';
import type { TimeClass } from '../chess/timeClass.js';

const router = new Hono();
router.use('*', requireAuth);

interface RatingRow { time_class: TimeClass; rating: number; rd: number; games_played: number; last_played_at: string | null }
interface HistoryRow { game_id: number; time_class: TimeClass; rating_before: number; rating_after: number; created_at: string }

router.get('/me', (c) => {
  const me = c.get('user');
  const rows = db.prepare(`SELECT time_class, rating, rd, games_played, last_played_at
                            FROM ratings WHERE user_id = ?`).all(me.id) as RatingRow[];
  const byClass: Record<TimeClass, ReturnType<typeof shape>> = {
    bullet: shape('bullet', null),
    blitz: shape('blitz', null),
    rapid: shape('rapid', null),
    daily: shape('daily', null),
  };
  for (const r of rows) byClass[r.time_class] = shape(r.time_class, r);
  return c.json({ ratings: byClass });
});

router.get('/history', (c) => {
  const me = c.get('user');
  const tc = c.req.query('time_class') as TimeClass | undefined;
  const limit = Math.min(Number(c.req.query('limit') ?? 30), 200);
  const rows = tc
    ? db.prepare(`SELECT game_id, time_class, rating_before, rating_after, created_at
                  FROM rating_history WHERE user_id = ? AND time_class = ?
                  ORDER BY created_at DESC LIMIT ?`).all(me.id, tc, limit) as HistoryRow[]
    : db.prepare(`SELECT game_id, time_class, rating_before, rating_after, created_at
                  FROM rating_history WHERE user_id = ?
                  ORDER BY created_at DESC LIMIT ?`).all(me.id, limit) as HistoryRow[];
  return c.json({ history: rows });
});

function shape(time_class: TimeClass, row: RatingRow | null) {
  const rating = row?.rating ?? GLICKO_DEFAULTS.rating;
  const rd = row?.rd ?? GLICKO_DEFAULTS.rd;
  const games = row?.games_played ?? 0;
  const provisional = rd >= PROVISIONAL_RD_THRESHOLD || games < PROVISIONAL_GAMES;
  return {
    time_class,
    rating: Math.round(rating),
    rd: Math.round(rd),
    games_played: games,
    last_played_at: row?.last_played_at ?? null,
    provisional,
  };
}

export default router;
