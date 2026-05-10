import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { db, userCount, setSetting } from '../db.js';
import { hashPassword } from '../auth/passwords.js';
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '../auth/sessions.js';
import { testOllama } from '../coach/ollama.js';

const router = new Hono();

router.get('/status', (c) => {
  return c.json({ setup_required: userCount() === 0 });
});

// Public test endpoint, available only during setup
router.post('/test-ollama', async (c) => {
  if (userCount() > 0) return c.json({ error: 'already_initialized' }, 409);
  const body = await c.req.json().catch(() => null) as { url?: string } | null;
  const url = body?.url;
  if (!url) return c.json({ ok: false, error: 'no_url' });
  const result = await testOllama(url);
  return c.json(result);
});

const setupSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(6).max(200),
  display_name: z.string().trim().min(1).max(60),
  language: z.enum(['en', 'bg']).default('en'),
  ollama_url: z.string().url().or(z.literal('')).optional(),
  ollama_model: z.string().optional(),
});

router.post('/init', async (c) => {
  if (userCount() > 0) return c.json({ error: 'already_initialized' }, 409);

  const body = await c.req.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);

  const { username, password, display_name, language, ollama_url, ollama_model } = parsed.data;

  const passwordHash = await hashPassword(password);
  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`);
  const insertProfile = db.prepare(
    `INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior) VALUES (?, ?, ?, 'intermediate', 'on_demand')`
  );

  const tx = db.transaction(() => {
    const result = insertUser.run(username, passwordHash);
    const userId = Number(result.lastInsertRowid);
    insertProfile.run(userId, display_name, language);
    return userId;
  });
  const userId = tx();

  if (ollama_url) setSetting('ollama_url', ollama_url);
  if (ollama_model) setSetting('ollama_model', ollama_model);
  setSetting('default_language', language);

  const cookie = createSession(userId);
  setCookie(c, SESSION_COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return c.json({ ok: true });
});

export default router;
