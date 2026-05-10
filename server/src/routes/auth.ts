import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { db } from '../db.js';
import { verifyPassword } from '../auth/passwords.js';
import {
  createSession,
  destroySession,
  lookupUser,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '../auth/sessions.js';
import type { Profile, Role } from '../types.js';

const router = new Hono();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

router.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const { username, password } = parsed.data;
  const row = db
    .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; password_hash: string; role: Role } | undefined;

  if (!row) return c.json({ error: 'invalid_credentials' }, 401);
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return c.json({ error: 'invalid_credentials' }, 401);

  const cookie = createSession(row.id);
  setCookie(c, SESSION_COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(row.id) as Profile;
  return c.json({ user: { id: row.id, username: row.username, role: row.role, profile } });
});

router.post('/logout', (c) => {
  const signed = getCookie(c, SESSION_COOKIE_NAME);
  if (signed) destroySession(signed);
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

router.get('/me', (c) => {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const user = lookupUser(cookie);
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

export default router;
