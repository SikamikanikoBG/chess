// Time-control classification, chess.com style.
// Total seconds = base + 40 * increment. Buckets:
//   bullet:   < 180s
//   blitz:    180–599s
//   rapid:    600–3599s
//   daily:    "1/N day" or any value ≥ 24h
// Untimed games and unrecognized formats return null (unrated pool).

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';

const NAMED: Record<string, TimeClass | null> = {
  untimed: null,
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'rapid', // we collapse classical into rapid (no separate pool)
  daily: 'daily',
};

/** Parse a chess.com / PGN time control string into a class.
 *  Accepts: keyword names, "<base>+<inc>", "<base>", "1/N" (daily), "-".
 *  Returns null if untimed or unparseable. */
export function classifyTimeControl(tc: string | null | undefined): TimeClass | null {
  if (!tc) return null;
  const s = String(tc).trim().toLowerCase();
  if (!s || s === '-') return null;
  if (s in NAMED) return NAMED[s] ?? null;

  // Daily: "1/N" where N = seconds per move (chess.com format).
  if (s.startsWith('1/')) return 'daily';

  // "base+inc" or just "base" in seconds.
  const m = /^(\d+)(?:\+(\d+))?$/.exec(s);
  if (m) {
    const base = Number(m[1]);
    const inc = Number(m[2] ?? 0);
    if (!Number.isFinite(base)) return null;
    const total = base + 40 * inc;
    if (total >= 24 * 3600) return 'daily';
    if (total < 180) return 'bullet';
    if (total < 600) return 'blitz';
    if (total < 3600) return 'rapid';
    return 'rapid';
  }
  return null;
}

/** Default time-control string for a known class (used when starting a PvP game). */
export function defaultTimeControlFor(cls: TimeClass): string {
  switch (cls) {
    case 'bullet':
      return '60+0';
    case 'blitz':
      return '300+0';
    case 'rapid':
      return '600+0';
    case 'daily':
      return '1/86400';
  }
}
