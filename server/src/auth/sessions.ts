import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import type { AuthedUser, Profile, Role } from '../types.js';

const SESSION_COOKIE = 'chess_session';
const SESSION_DAYS = 30;

interface SessionRow {
  token: string;
  user_id: number;
  expires_at: string;
}

interface UserRow {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

function sign(token: string): string {
  return createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

function verifySigned(signed: string): string | null {
  const parts = signed.split('.');
  if (parts.length !== 2) return null;
  const [token, sig] = parts;
  if (!token || !sig) return null;
  const expected = sign(token);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return token;
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return `${token}.${sign(token)}`;
}

export function destroySession(signed: string): void {
  const token = verifySigned(signed);
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function lookupUser(signed: string | undefined): AuthedUser | null {
  if (!signed) return null;
  const token = verifySigned(signed);
  if (!token) return null;
  const session = db
    .prepare(`SELECT token, user_id, expires_at FROM sessions WHERE token = ? AND expires_at > datetime('now')`)
    .get(token) as SessionRow | undefined;
  if (!session) return null;
  const user = db
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .get(session.user_id) as UserRow | undefined;
  if (!user) return null;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id) as Profile | undefined;
  if (!profile) return null;
  return { ...user, profile };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 86400;
