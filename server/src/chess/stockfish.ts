import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { getSetting } from '../db.js';

function discoverStockfishPath(): string | null {
  const candidates = [
    config.stockfishPathHint,
    getSetting('stockfish_path') || undefined,
    resolve(config.projectRoot, 'bin', process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'),
    '/usr/games/stockfish',
    '/usr/bin/stockfish',
    'stockfish',
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (p === 'stockfish') return p;
    if (existsSync(p)) return p;
  }
  return null;
}

export interface EngineEval {
  cp: number | null; // centipawns from side-to-move's perspective
  mate: number | null; // moves to mate (positive = side-to-move mates)
  bestMoveUci: string | null;
  pv: string[]; // principal variation in UCI
  depth: number;
}

export class StockfishEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private waiters: ((line: string) => void)[] = [];
  private readonly path: string;
  private ready = false;

  constructor(path?: string) {
    const p = path ?? discoverStockfishPath();
    if (!p) throw new Error('Stockfish binary not found. Run setup.ps1 or set STOCKFISH_PATH.');
    this.path = p;
  }

  static async test(path?: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    try {
      const e = new StockfishEngine(path);
      await e.start();
      const name = await e.name();
      e.quit();
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async start(): Promise<void> {
    this.proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.on('error', (err) => console.error('[stockfish]', err));
    await this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.ready = true;
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w(line);
    }
  }

  private send(cmd: string): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.proc) return rej(new Error('engine not started'));
      this.proc.stdin.write(cmd + '\n', (err) => (err ? rej(err) : res()));
    });
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolveLine, rejectLine) => {
      const t = setTimeout(() => rejectLine(new Error('engine timeout')), timeoutMs);
      const check = (line: string) => {
        if (predicate(line)) {
          clearTimeout(t);
          resolveLine(line);
        } else {
          this.waiters.push(check);
        }
      };
      this.waiters.push(check);
    });
  }

  async setOption(name: string, value: string | number): Promise<void> {
    await this.send(`setoption name ${name} value ${value}`);
  }

  async newGame(): Promise<void> {
    await this.send('ucinewgame');
    await this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  async name(): Promise<string> {
    await this.send('uci');
    const line = await this.waitFor((l) => l.startsWith('id name') || l === 'uciok');
    if (line.startsWith('id name')) return line.replace('id name ', '');
    return 'Stockfish';
  }

  async evaluate(fen: string, depth: number): Promise<EngineEval> {
    await this.send(`position fen ${fen}`);
    await this.send(`go depth ${depth}`);

    let lastInfo: { cp: number | null; mate: number | null; pv: string[]; depth: number } = {
      cp: null,
      mate: null,
      pv: [],
      depth: 0,
    };
    let bestMove: string | null = null;

    await new Promise<void>((res) => {
      const handler = (line: string) => {
        if (line.startsWith('info ')) {
          const parsed = parseInfoLine(line);
          if (parsed && parsed.depth >= lastInfo.depth) lastInfo = parsed;
          this.waiters.push(handler);
        } else if (line.startsWith('bestmove')) {
          const m = line.split(' ')[1];
          bestMove = m === '(none)' ? null : (m ?? null);
          res();
        } else {
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
    });

    return {
      cp: lastInfo.cp,
      mate: lastInfo.mate,
      bestMoveUci: bestMove,
      pv: lastInfo.pv,
      depth: lastInfo.depth,
    };
  }

  async bestMove(fen: string, opts: { depth?: number; movetimeMs?: number; skill?: number }): Promise<string | null> {
    if (opts.skill !== undefined) await this.setOption('Skill Level', opts.skill);
    await this.send(`position fen ${fen}`);
    if (opts.movetimeMs !== undefined) await this.send(`go movetime ${opts.movetimeMs}`);
    else await this.send(`go depth ${opts.depth ?? 12}`);
    let best: string | null = null;
    await new Promise<void>((res) => {
      const handler = (line: string) => {
        if (line.startsWith('bestmove')) {
          const m = line.split(' ')[1];
          best = m === '(none)' ? null : (m ?? null);
          res();
        } else {
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
    });
    return best;
  }

  quit(): void {
    if (!this.proc) return;
    try { this.proc.stdin.write('quit\n'); } catch { /* ignore */ }
    setTimeout(() => this.proc?.kill(), 200);
    this.proc = null;
    this.ready = false;
  }

  isReady(): boolean { return this.ready; }
}

function parseInfoLine(line: string): { cp: number | null; mate: number | null; pv: string[]; depth: number } | null {
  const tokens = line.split(' ');
  let cp: number | null = null;
  let mate: number | null = null;
  let depth = 0;
  let pv: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val = Number(tokens[++i]);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  return { cp, mate, pv, depth };
}
