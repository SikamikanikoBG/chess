import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { Chess } from 'chess.js';
import { lookupUser, SESSION_COOKIE_NAME } from '../auth/sessions.js';
import { StockfishEngine } from '../chess/stockfish.js';
import { db } from '../db.js';
import { analyzePgn } from '../routes/analyze.js';
import type { AuthedUser, Difficulty } from '../types.js';

interface DifficultyConfig { skill: number; depth: number; movetimeMs: number }

const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  kid:        { skill: 0,  depth: 1,  movetimeMs: 100 },
  beginner:   { skill: 3,  depth: 4,  movetimeMs: 200 },
  easy:       { skill: 7,  depth: 6,  movetimeMs: 300 },
  medium:     { skill: 12, depth: 10, movetimeMs: 500 },
  hard:       { skill: 16, depth: 14, movetimeMs: 800 },
  master:     { skill: 20, depth: 18, movetimeMs: 1500 },
  stockfish:  { skill: 20, depth: 22, movetimeMs: 3000 },
};

interface GameSession {
  user: AuthedUser;
  chess: Chess;
  engine: StockfishEngine;
  difficulty: Difficulty;
  userColor: 'white' | 'black';
  timeControl: { initial: number; increment: number } | null;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
  saved: boolean;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function send(ws: WebSocket, type: string, data: Record<string, unknown> = {}) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

const TIME_CONTROLS: Record<string, { initial: number; increment: number } | null> = {
  bullet:    { initial: 60_000,    increment: 0 },
  blitz:     { initial: 5 * 60_000, increment: 0 },
  rapid:     { initial: 10 * 60_000, increment: 0 },
  classical: { initial: 30 * 60_000, increment: 0 },
  untimed:   null,
};

export function attachPlayWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/play')) return;
    const cookies = parseCookies(req.headers.cookie);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];
    const user = lookupUser(sessionCookie);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, user);
    });
  });
}

async function handleConnection(ws: WebSocket, user: AuthedUser) {
  let session: GameSession | null = null;

  send(ws, 'hello', { user: { id: user.id, username: user.username, display_name: user.profile.display_name } });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg.type as string;

    try {
      if (type === 'new_game') {
        if (session) {
          try { session.engine.quit(); } catch { /* ignore */ }
        }
        const difficulty = (msg.difficulty as Difficulty) ?? 'medium';
        const userColor = (msg.color as 'white' | 'black') ?? 'white';
        const tcKey = (msg.time_control as string) ?? 'untimed';
        const tc = TIME_CONTROLS[tcKey] ?? null;

        const engine = new StockfishEngine();
        await engine.start();
        const conf = DIFFICULTY[difficulty];
        await engine.setOption('Skill Level', conf.skill);
        await engine.setOption('Threads', '1');
        await engine.setOption('Hash', '32');
        await engine.newGame();

        session = {
          user, chess: new Chess(), engine, difficulty, userColor,
          timeControl: tc,
          whiteTimeMs: tc?.initial ?? 0,
          blackTimeMs: tc?.initial ?? 0,
          lastMoveAt: Date.now(),
          saved: false,
        };

        send(ws, 'game_started', {
          fen: session.chess.fen(), turn: session.chess.turn(),
          difficulty, userColor, time_control: tcKey,
          whiteTimeMs: session.whiteTimeMs, blackTimeMs: session.blackTimeMs,
        });

        if (userColor === 'black') await playEngineMove(ws, session);
      } else if (type === 'move' && session) {
        const uci = msg.uci as string;
        if (!uci || uci.length < 4) return;
        const turn = session.chess.turn();
        const expected = session.userColor[0];
        if (turn !== expected) { send(ws, 'error', { message: 'not your turn' }); return; }

        // Update clocks
        if (session.timeControl) {
          const elapsed = Date.now() - session.lastMoveAt;
          if (turn === 'w') session.whiteTimeMs -= elapsed; else session.blackTimeMs -= elapsed;
          if ((turn === 'w' ? session.whiteTimeMs : session.blackTimeMs) <= 0) {
            await endGame(ws, session, turn === 'w' ? '0-1' : '1-0', 'time');
            return;
          }
          if (turn === 'w') session.whiteTimeMs += session.timeControl.increment;
          else session.blackTimeMs += session.timeControl.increment;
          session.lastMoveAt = Date.now();
        }

        const move = session.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
        if (!move) { send(ws, 'error', { message: 'illegal move' }); return; }

        send(ws, 'move_made', {
          fen: session.chess.fen(), san: move.san, uci, by: 'user',
          whiteTimeMs: session.whiteTimeMs, blackTimeMs: session.blackTimeMs,
        });

        if (await checkGameOver(ws, session)) return;
        await playEngineMove(ws, session);
      } else if (type === 'resign' && session) {
        await endGame(ws, session, session.userColor === 'white' ? '0-1' : '1-0', 'resignation');
      } else if (type === 'request_hint' && session) {
        // Hint via engine: get a top move at modest depth
        const fen = session.chess.fen();
        const ev = await session.engine.evaluate(fen, 12);
        send(ws, 'hint', { best_uci: ev.bestMoveUci, eval_cp: ev.cp });
      }
    } catch (err) {
      send(ws, 'error', { message: err instanceof Error ? err.message : String(err) });
    }
  });

  ws.on('close', () => {
    if (session) try { session.engine.quit(); } catch { /* ignore */ }
  });
}

async function playEngineMove(ws: WebSocket, session: GameSession) {
  const conf = DIFFICULTY[session.difficulty];
  const uci = await session.engine.bestMove(session.chess.fen(), {
    skill: conf.skill,
    movetimeMs: conf.movetimeMs,
  });
  if (!uci) return;
  if (session.timeControl) {
    const elapsed = Date.now() - session.lastMoveAt;
    const turn = session.chess.turn();
    if (turn === 'w') session.whiteTimeMs -= elapsed; else session.blackTimeMs -= elapsed;
    session.lastMoveAt = Date.now();
  }
  const move = session.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  if (!move) return;
  send(ws, 'move_made', {
    fen: session.chess.fen(), san: move.san, uci, by: 'engine',
    whiteTimeMs: session.whiteTimeMs, blackTimeMs: session.blackTimeMs,
  });
  await checkGameOver(ws, session);
}

async function checkGameOver(ws: WebSocket, session: GameSession): Promise<boolean> {
  if (!session.chess.isGameOver()) return false;
  let result: '1-0' | '0-1' | '1/2-1/2' = '1/2-1/2';
  let reason: string = 'draw';
  if (session.chess.isCheckmate()) {
    result = session.chess.turn() === 'w' ? '0-1' : '1-0';
    reason = 'checkmate';
  } else if (session.chess.isStalemate()) reason = 'stalemate';
  else if (session.chess.isThreefoldRepetition()) reason = 'repetition';
  else if (session.chess.isInsufficientMaterial()) reason = 'insufficient_material';
  else if (session.chess.isDraw()) reason = 'fifty_move_or_draw';
  await endGame(ws, session, result, reason);
  return true;
}

async function endGame(ws: WebSocket, session: GameSession, result: '1-0' | '0-1' | '1/2-1/2', reason: string) {
  if (session.saved) return;
  session.saved = true;
  send(ws, 'game_over', { result, reason, fen: session.chess.fen() });

  // Persist to DB
  const userId = session.user.id;
  const white = session.userColor === 'white' ? session.user.profile.display_name : `Stockfish (${session.difficulty})`;
  const black = session.userColor === 'black' ? session.user.profile.display_name : `Stockfish (${session.difficulty})`;

  session.chess.header('Event', 'Local game vs bot');
  session.chess.header('White', white);
  session.chess.header('Black', black);
  session.chess.header('Result', result);
  session.chess.header('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
  const pgn = session.chess.pgn();

  const r = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, end_time, user_color)
    VALUES (?, 'played', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pgn, white, black,
    result === '1-0' && session.userColor === 'white' || result === '0-1' && session.userColor === 'black' ? 'win'
      : result === '1/2-1/2' ? 'draw' : 'loss',
    session.timeControl ? `${session.timeControl.initial / 1000}+${session.timeControl.increment / 1000}` : 'untimed',
    new Date().toISOString(),
    session.userColor,
  );
  const gameId = Number(r.lastInsertRowid);

  send(ws, 'game_saved', { game_id: gameId });

  // Auto-analyze in background
  try { session.engine.quit(); } catch { /* ignore */ }
  setImmediate(async () => {
    try {
      const analysis = await analyzePgn(pgn, 14);
      db.prepare(`
        INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, moves_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(gameId, 14, analysis.accuracy_white, analysis.accuracy_black, JSON.stringify(analysis.moves));
    } catch (err) {
      console.error('[auto-analyze]', err);
    }
  });
}
