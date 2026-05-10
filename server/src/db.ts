import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    avatar_emoji TEXT NOT NULL DEFAULT '♟',
    language TEXT NOT NULL DEFAULT 'en',
    audience TEXT NOT NULL DEFAULT 'intermediate' CHECK(audience IN ('kid','beginner','intermediate','advanced')),
    chesscom_username TEXT,
    coach_behavior TEXT NOT NULL DEFAULT 'on_demand' CHECK(coach_behavior IN ('silent','on_demand','always_on_pedagogical')),
    tts_enabled INTEGER NOT NULL DEFAULT 0,
    tts_voice TEXT,
    tts_rate REAL NOT NULL DEFAULT 1.0,
    tts_pitch REAL NOT NULL DEFAULT 1.0,
    board_theme TEXT NOT NULL DEFAULT 'wood',
    piece_set TEXT NOT NULL DEFAULT 'cburnett',
    site_theme TEXT NOT NULL DEFAULT 'auto'
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK(source IN ('chesscom','played','imported','pvp')),
    external_id TEXT,
    pgn TEXT NOT NULL,
    white TEXT,
    black TEXT,
    result TEXT,
    time_control TEXT,
    end_time TEXT,
    user_color TEXT CHECK(user_color IN ('white','black')),
    opponent_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, source, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS analyses (
    game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    depth INTEGER NOT NULL,
    accuracy_white REAL,
    accuracy_black REAL,
    estimated_elo_white INTEGER,
    estimated_elo_black INTEGER,
    moves_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id, end_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    color TEXT NOT NULL CHECK(color IN ('white','black','random')),
    time_control TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled','expired')),
    game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_to ON challenges(to_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_challenges_from ON challenges(from_user_id, status)`,
];

for (const stmt of SCHEMA) db.exec(stmt);

// Idempotent migrations for existing installs
function ensureColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
ensureColumn('analyses', 'estimated_elo_white', 'INTEGER');
ensureColumn('analyses', 'estimated_elo_black', 'INTEGER');
// scoring_version lets us silently re-run analyses when the classifier or
// elo curve changes. Default 1 = "pre-versioned" = stale until re-analyzed.
ensureColumn('analyses', 'scoring_version', `INTEGER NOT NULL DEFAULT 1`);
ensureColumn('profiles', 'site_theme', `TEXT NOT NULL DEFAULT 'auto'`);
ensureColumn('profiles', 'blunder_warning', `INTEGER NOT NULL DEFAULT 0`);
ensureColumn('profiles', 'sound_enabled', `INTEGER NOT NULL DEFAULT 1`);
ensureColumn('games', 'opponent_user_id', `INTEGER REFERENCES users(id) ON DELETE SET NULL`);
// PvP clock persistence — without these a refresh during a blitz game silently
// reset both clocks to the time control's initial. last_move_at is needed so
// the reconnecting peer doesn't get free time on their opponent's account.
ensureColumn('games', 'white_time_ms', 'INTEGER');
ensureColumn('games', 'black_time_ms', 'INTEGER');
ensureColumn('games', 'last_move_at', 'TEXT');
// Idle-expiry guard for sessions: an absolute 30-day expiry alone is too long
// for a stolen cookie. We now also reject sessions with >7 days of inactivity.
// SQLite refuses non-constant DEFAULTs on ALTER ADD COLUMN, so we add the
// column nullable and backfill existing rows to "now" — kicking everyone out
// at deploy time would be hostile for what's a transparent improvement.
ensureColumn('sessions', 'last_active_at', `TEXT`);
db.prepare(`UPDATE sessions SET last_active_at = datetime('now') WHERE last_active_at IS NULL`).run();

// Cleanup expired sessions on startup
db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
// Sweep stale challenges on startup. Pending challenges older than 15 minutes
// are noise — most senders have closed the tab and the recipient never saw it.
// A read-time filter (in challenges.ts) handles fresh installs; the sweep keeps
// the table from growing unbounded.
db.prepare(`UPDATE challenges SET status = 'expired'
            WHERE status = 'pending' AND created_at < datetime('now','-15 minutes')`).run();

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function userCount(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  return row.c;
}
