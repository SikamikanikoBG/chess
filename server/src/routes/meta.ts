import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

const router = new Hono();

let cachedVersion: string | null = null;
function readVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(resolve(config.projectRoot, 'package.json'), 'utf8'));
    cachedVersion = String(pkg.version ?? 'unknown');
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

let cachedChangelog: string | null = null;
function readChangelog(): string {
  if (cachedChangelog !== null) return cachedChangelog;
  const path = resolve(config.projectRoot, 'CHANGELOG.md');
  cachedChangelog = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return cachedChangelog;
}

router.get('/', (c) => {
  return c.json({ version: readVersion(), name: 'chess' });
});

router.get('/changelog', (c) => {
  return c.body(readChangelog(), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

export default router;
