import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function resolveDbPath(): string {
  const raw = process.env.DB_PATH ?? './data/chess.db';
  const abs = resolve(PROJECT_ROOT, raw);
  ensureDir(abs);
  return abs;
}

function loadOrCreateSessionSecret(dbPath: string): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = resolve(dirname(dbPath), '.session-secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const dbPath = resolveDbPath();

export const config = {
  port: Number(process.env.PORT ?? 8800),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath,
  sessionSecret: loadOrCreateSessionSecret(dbPath),
  stockfishPathHint: process.env.STOCKFISH_PATH || undefined,
  projectRoot: PROJECT_ROOT,
};
