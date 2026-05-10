import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
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

// Per-IP + per-username sliding window. bcrypt cost-12 is ~250ms per check,
// so without this an attacker can pin the event loop with parallel POSTs.
// Limits are intentionally generous for legitimate users (10 attempts in 5
// minutes) but cut credential stuffing dead. The window is in-process, so it
// resets on container restart — that's acceptable for a single-host deploy.
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const userBuckets = new Map<string, Bucket>();

function takeBucket(map: Map<string, Bucket>, key: string, now: number): Bucket {
  let b = map.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    map.set(key, b);
  }
  return b;
}

function rateLimit(ip: string, username: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  // Lazy GC — sweep every call on average without paying for setInterval timers.
  if (ipBuckets.size > 1000 || userBuckets.size > 1000) {
    for (const [k, v] of ipBuckets) if (v.resetAt <= now) ipBuckets.delete(k);
    for (const [k, v] of userBuckets) if (v.resetAt <= now) userBuckets.delete(k);
  }
  const ipBucket = takeBucket(ipBuckets, ip, now);
  const userBucket = takeBucket(userBuckets, username.toLowerCase(), now);
  if (ipBucket.count >= LOGIN_MAX_ATTEMPTS || userBucket.count >= LOGIN_MAX_ATTEMPTS) {
    const resetAt = Math.max(ipBucket.resetAt, userBucket.resetAt);
    return { allowed: false, retryAfter: Math.ceil((resetAt - now) / 1000) };
  }
  ipBucket.count++;
  userBucket.count++;
  return { allowed: true, retryAfter: 0 };
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  // Prefer X-Forwarded-For if a reverse proxy is in front; first hop is the client.
  // Hono's node adapter exposes the underlying socket via `getConnInfo`, but for
  // rate-limiting purposes a coarse "direct" bucket is fine when no proxy is in
  // play — the per-username bucket is the dominant guard against credential
  // stuffing, and a real LAN deploy almost always has a proxy.
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = c.req.header('x-real-ip');
  if (real) return real.trim();
  return 'direct';
}

function sessionCookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: config.cookieSecure,
  };
}

router.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const { username, password } = parsed.data;
  const ip = clientIp(c);
  const limit = rateLimit(ip, username);
  if (!limit.allowed) {
    console.warn(`[auth] rate_limited ip=${ip} user=${username}`);
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ error: 'rate_limited', retry_after: limit.retryAfter }, 429);
  }

  const row = db
    .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; password_hash: string; role: Role } | undefined;

  if (!row) {
    console.warn(`[auth] login_failed ip=${ip} user=${username} reason=unknown_user`);
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    console.warn(`[auth] login_failed ip=${ip} user=${username} reason=bad_password`);
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  // Rotate: any cookie they were carrying gets replaced; the old token (if it
  // was a valid session) is destroyed so a stolen pre-login cookie can't ride
  // the freshly-authenticated identity.
  const existing = getCookie(c, SESSION_COOKIE_NAME);
  if (existing) destroySession(existing);

  const cookie = createSession(row.id);
  setCookie(c, SESSION_COOKIE_NAME, cookie, sessionCookieOpts());

  console.log(`[auth] login_ok ip=${ip} user=${username} role=${row.role}`);
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
