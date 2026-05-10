import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import { Chess } from 'chess.js';
import { lookupUser, SESSION_COOKIE_NAME } from '../auth/sessions.js';
import { StockfishEngine } from '../chess/stockfish.js';
import { db } from '../db.js';
import { analyzePgn } from '../routes/analyze.js';
import { classifyByWpDrop, refineClassification, normalizeEval, cpToWinPct, SCORING_VERSION } from '../chess/classifier.js';
import type { AuthedUser, Difficulty, Classification } from '../types.js';
import { notifyUser } from './lobby.js';

// `Skill Level` alone produces tiers that don't match their labels — at
// `Skill 3 / depth 4`, "Beginner" already plays around 1400 Elo, so a
// chess.com 800-rated kid picking "Easy" gets crushed. We now drive tiers
// through `UCI_LimitStrength` + `UCI_Elo`, which Stockfish supports natively
// (range ~1320..3190) and which targets a real rating rather than a search
// shape. The top two tiers turn the limiter off so they play full strength.
interface DifficultyConfig {
  /** When set, enables UCI_LimitStrength + UCI_Elo at this rating. */
  uciElo: number | null;
  /** Search depth — kept low for fast bot moves on weak tiers. */
  depth: number;
  /** Move time cap; combines with depth so a long search doesn't stall play. */
  movetimeMs: number;
}

const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  kid:        { uciElo: 1320, depth: 1,  movetimeMs: 100 },  // Stockfish floor + depth 1 = many hung pieces, deliberately
  beginner:   { uciElo: 1500, depth: 6,  movetimeMs: 250 },
  easy:       { uciElo: 1700, depth: 8,  movetimeMs: 350 },
  medium:     { uciElo: 1900, depth: 12, movetimeMs: 500 },
  hard:       { uciElo: 2200, depth: 16, movetimeMs: 900 },
  master:     { uciElo: 2500, depth: 18, movetimeMs: 1500 },
  stockfish:  { uciElo: null, depth: 22, movetimeMs: 3000 },
};

async function applyDifficulty(engine: StockfishEngine, conf: DifficultyConfig): Promise<void> {
  if (conf.uciElo !== null) {
    await engine.setOption('UCI_LimitStrength', 'true');
    await engine.setOption('UCI_Elo', conf.uciElo);
  } else {
    await engine.setOption('UCI_LimitStrength', 'false');
  }
}

const TIME_CONTROLS: Record<string, { initial: number; increment: number } | null> = {
  bullet:    { initial: 60_000,    increment: 0 },
  blitz:     { initial: 5 * 60_000, increment: 0 },
  rapid:     { initial: 10 * 60_000, increment: 0 },
  classical: { initial: 30 * 60_000, increment: 0 },
  untimed:   null,
};

// ---- BOT SESSION ----

interface BotSession {
  kind: 'bot';
  user: AuthedUser;
  chess: Chess;
  engine: StockfishEngine;            // plays the bot moves at chosen skill
  analysisEngine: StockfishEngine | null; // lazy, used for hints + classification + blunder preview at full strength
  analysisQueue: Promise<void>;       // serializes evaluations on the analysis engine
  difficulty: Difficulty;
  userColor: 'white' | 'black';
  timeControl: { initial: number; increment: number } | null;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
  saved: boolean;
}

// ---- PVP SESSION ----

interface PvpPlayer { user_id: number; ws: WebSocket | null; display_name: string }
interface PvpSession {
  kind: 'pvp';
  game_id: number;
  external_id: string;
  chess: Chess;
  white: PvpPlayer;
  black: PvpPlayer;
  timeControl: { initial: number; increment: number } | null;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
  saved: boolean;
  analysisEngine: StockfishEngine | null;
  analysisQueue: Promise<void>;
}

const pvpSessions = new Map<number, PvpSession>(); // game_id → session

// Drop PvP sessions where neither side has been connected for a long time.
// Without this, an abandoned game accumulates a Chess instance + an idle
// Stockfish analysis engine + waiter set in memory until the process exits.
// PGN + clocks are already persisted to the games row, so a returning player
// rehydrates from disk without losing state.
const PVP_IDLE_TTL_MS = 15 * 60_000;
const PVP_LONG_TTL_MS = 6 * 60 * 60_000; // even with one side connected, drop after 6h
setInterval(() => {
  const now = Date.now();
  for (const [gameId, s] of pvpSessions) {
    const bothGone = !s.white.ws && !s.black.ws;
    const idleFor = now - s.lastMoveAt;
    if (bothGone && idleFor > PVP_IDLE_TTL_MS) {
      if (s.analysisEngine) s.analysisEngine.quit().catch(() => { /* ignore */ });
      pvpSessions.delete(gameId);
    } else if (idleFor > PVP_LONG_TTL_MS) {
      if (s.analysisEngine) s.analysisEngine.quit().catch(() => { /* ignore */ });
      pvpSessions.delete(gameId);
    }
  }
}, 5 * 60_000).unref();

function send(ws: WebSocket, type: string, data: Record<string, unknown> = {}) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function ensureAnalysisEngine(holder: { analysisEngine: StockfishEngine | null }): Promise<StockfishEngine> {
  if (holder.analysisEngine) return holder.analysisEngine;
  const e = new StockfishEngine();
  await e.start();
  await e.setOption('Skill Level', 20);
  await e.setOption('Threads', '1');
  await e.setOption('Hash', '32');
  holder.analysisEngine = e;
  return e;
}

// Serialize work on the analysis engine. Two concurrent evaluate() calls would
// interleave UCI commands and corrupt the engine's state.
function runOnAnalysisEngine<T>(holder: { analysisQueue: Promise<void> }, fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((res) => { release = res; });
  const prev = holder.analysisQueue;
  holder.analysisQueue = next;
  return prev.then(async () => {
    try { return await fn(); }
    finally { release(); }
  });
}

// Quick-classify a played move: eval position before (best move + score),
// eval position after (next best for opponent), compute cp_loss + classification.
async function quickClassify(args: {
  engine: StockfishEngine;
  fenBefore: string;
  fenAfter: string;
  moveUci: string;
  depth?: number;
}): Promise<{ classification: Classification; cp_loss: number; best_uci: string | null; best_san: string | null; eval_after_cp: number }> {
  const depth = args.depth ?? 10;
  const evBefore = await args.engine.evaluate(args.fenBefore, depth);
  const evAfter = await args.engine.evaluate(args.fenAfter, depth);

  const stmBefore: 'w' | 'b' = (args.fenBefore.split(' ')[1] === 'w' ? 'w' : 'b');
  const stmAfter: 'w' | 'b' = (args.fenAfter.split(' ')[1] === 'w' ? 'w' : 'b');

  const beforeWhite = normalizeEval(evBefore.cp, evBefore.mate, stmBefore);
  const afterWhite = normalizeEval(evAfter.cp, evAfter.mate, stmAfter);

  // Compute from player's POV (the side that just moved)
  const playerColor = stmBefore;
  const playerBefore = playerColor === 'w' ? beforeWhite : -beforeWhite;
  const playerAfter = playerColor === 'w' ? afterWhite : -afterWhite;

  const wpBefore = cpToWinPct(playerBefore);
  const wpAfter = cpToWinPct(playerAfter);
  const wpDrop = Math.max(0, wpBefore - wpAfter);
  const cp_loss = Math.max(0, Math.round(playerBefore - playerAfter));

  const isBest = evBefore.bestMoveUci === args.moveUci;
  const baseCls = classifyByWpDrop(wpDrop, cp_loss, isBest);
  // Live-play classify uses single-PV (no MultiPV) so we pass empty candidates
  // (Great is unreachable here) and a high ply number (Book is also unreachable
  // — book moves are only labelled in the post-game review pipeline).
  const legalMoveCount = new Chess(args.fenBefore).moves().length;
  const cls = refineClassification({
    base: baseCls,
    isBest, cpLoss: cp_loss,
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    sideToMove: playerColor === 'w' ? 'white' : 'black',
    playerEvalBeforeCp: playerBefore,
    playerEvalAfterCp: playerAfter,
    ply: 99,
    legalMoveCount,
    candidatePlayerCps: [],
  });

  // Convert best UCI to SAN for display
  let best_san: string | null = null;
  if (evBefore.bestMoveUci) {
    try {
      const probe = new Chess(args.fenBefore);
      const m = probe.move({ from: evBefore.bestMoveUci.slice(0, 2), to: evBefore.bestMoveUci.slice(2, 4), promotion: evBefore.bestMoveUci.slice(4) || undefined });
      if (m) best_san = m.san;
    } catch { /* ignore */ }
  }

  return {
    classification: cls,
    cp_loss,
    best_uci: evBefore.bestMoveUci,
    best_san,
    eval_after_cp: afterWhite,
  };
}

// ---- ATTACH ----

export function attachPlayWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/play')) return;
    const cookies = parseCookies(req.headers.cookie);
    const user = lookupUser(cookies[SESSION_COOKIE_NAME]);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      routeConnection(ws, user, req);
    });
  });
}

function routeConnection(ws: WebSocket, user: AuthedUser, req: IncomingMessage) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const gameParam = url.searchParams.get('game');
  if (gameParam) {
    const gameId = Number(gameParam);
    if (!Number.isFinite(gameId)) {
      send(ws, 'error', { message: 'invalid game id' });
      ws.close();
      return;
    }
    handlePvpConnection(ws, user, gameId);
  } else {
    handleBotConnection(ws, user);
  }
}

// ---- BOT GAME ----

async function handleBotConnection(ws: WebSocket, user: AuthedUser) {
  let session: BotSession | null = null;

  send(ws, 'hello', { user: { id: user.id, username: user.username, display_name: user.profile.display_name } });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg.type as string;

    try {
      if (type === 'new_game') {
        if (session) {
          session.engine.quit().catch(() => { /* ignore */ });
          if (session.analysisEngine) session.analysisEngine.quit().catch(() => { /* ignore */ });
        }
        const difficulty = (msg.difficulty as Difficulty) ?? 'medium';
        const userColor = (msg.color as 'white' | 'black') ?? 'white';
        const tcKey = (msg.time_control as string) ?? 'untimed';
        const tc = TIME_CONTROLS[tcKey] ?? null;

        const engine = new StockfishEngine();
        await engine.start();
        const conf = DIFFICULTY[difficulty];
        await engine.setOption('Threads', '1');
        await engine.setOption('Hash', '32');
        await applyDifficulty(engine, conf);
        await engine.newGame();

        session = {
          kind: 'bot', user,
          chess: new Chess(), engine, analysisEngine: null, analysisQueue: Promise.resolve(),
          difficulty, userColor,
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

        if (userColor === 'black') await playBotMove(ws, session);
      } else if (type === 'move' && session) {
        const uci = msg.uci as string;
        if (!uci || uci.length < 4) return;
        const turn = session.chess.turn();
        const expected = session.userColor[0];
        if (turn !== expected) { send(ws, 'error', { message: 'not your turn' }); return; }

        if (session.timeControl) {
          const elapsed = Date.now() - session.lastMoveAt;
          if (turn === 'w') session.whiteTimeMs -= elapsed; else session.blackTimeMs -= elapsed;
          if ((turn === 'w' ? session.whiteTimeMs : session.blackTimeMs) <= 0) {
            await endBotGame(ws, session, turn === 'w' ? '0-1' : '1-0', 'time');
            return;
          }
          if (turn === 'w') session.whiteTimeMs += session.timeControl.increment;
          else session.blackTimeMs += session.timeControl.increment;
          session.lastMoveAt = Date.now();
        }

        const fenBefore = session.chess.fen();
        const move = session.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
        if (!move) { send(ws, 'error', { message: 'illegal move' }); return; }

        send(ws, 'move_made', {
          fen: session.chess.fen(), san: move.san, uci, by: 'user',
          whiteTimeMs: session.whiteTimeMs, blackTimeMs: session.blackTimeMs,
        });

        // Capture the post-user-move state SYNCHRONOUSLY before the bot moves.
        // (Reading session.chess.fen() inside the async IIFE was racing with playBotMove.)
        const fenAfterUserMove = session.chess.fen();
        const userPly = session.chess.history().length;
        void runOnAnalysisEngine(session, async () => {
          try {
            const a = await ensureAnalysisEngine(session!);
            const result = await quickClassify({
              engine: a, fenBefore, fenAfter: fenAfterUserMove,
              moveUci: uci, depth: 10,
            });
            send(ws, 'move_classified', {
              ply: userPly, uci,
              classification: result.classification,
              cp_loss: result.cp_loss,
              best_uci: result.best_uci,
              best_san: result.best_san,
              by: 'user',
            });
          } catch (err) {
            console.error('[classify-user-move]', err);
          }
        });

        if (await checkBotGameOver(ws, session)) return;
        await playBotMove(ws, session);
      } else if (type === 'preview_move' && session) {
        // Used by kid mode — pre-evaluate before committing
        const uci = msg.uci as string;
        if (!uci || uci.length < 4) return;
        const fenBefore = session.chess.fen();
        const probe = new Chess(fenBefore);
        const m = probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
        if (!m) { send(ws, 'preview_result', { ok: false, message: 'illegal' }); return; }
        const fenAfter = probe.fen();
        await runOnAnalysisEngine(session, async () => {
          try {
            const a = await ensureAnalysisEngine(session!);
            const result = await quickClassify({
              engine: a, fenBefore, fenAfter,
              moveUci: uci, depth: 10,
            });
            send(ws, 'preview_result', { ok: true, uci, ...result });
          } catch (err) {
            send(ws, 'preview_result', { ok: false, message: (err as Error).message });
          }
        });
      } else if (type === 'resign' && session) {
        await endBotGame(ws, session, session.userColor === 'white' ? '0-1' : '1-0', 'resignation');
      } else if (type === 'request_hint' && session) {
        // Use the analysis engine, NOT the bot engine — avoids contention
        // and keeps the bot game state clean.
        const fen = session.chess.fen();
        await runOnAnalysisEngine(session, async () => {
          try {
            const a = await ensureAnalysisEngine(session!);
            const ev = await a.evaluate(fen, 12);
            send(ws, 'hint', { best_uci: ev.bestMoveUci, eval_cp: ev.cp });
          } catch (err) {
            send(ws, 'hint', { best_uci: null, error: (err as Error).message });
          }
        });
      }
    } catch (err) {
      send(ws, 'error', { message: err instanceof Error ? err.message : String(err) });
    }
  });

  ws.on('close', () => {
    if (session) {
      session.engine.quit().catch(() => { /* ignore */ });
      if (session.analysisEngine) session.analysisEngine.quit().catch(() => { /* ignore */ });
    }
  });
}

async function playBotMove(ws: WebSocket, session: BotSession) {
  const conf = DIFFICULTY[session.difficulty];
  // Strength is now baked in via UCI_LimitStrength/UCI_Elo at session start —
  // we only pass the search budget here.
  const uci = await session.engine.bestMove(session.chess.fen(), {
    movetimeMs: conf.movetimeMs,
    depth: conf.depth,
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
  await checkBotGameOver(ws, session);
}

async function checkBotGameOver(ws: WebSocket, session: BotSession): Promise<boolean> {
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
  await endBotGame(ws, session, result, reason);
  return true;
}

async function endBotGame(ws: WebSocket, session: BotSession, result: '1-0' | '0-1' | '1/2-1/2', reason: string) {
  if (session.saved) return;
  session.saved = true;
  send(ws, 'game_over', { result, reason, fen: session.chess.fen() });

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

  session.engine.quit().catch(() => { /* ignore */ });
  if (session.analysisEngine) session.analysisEngine.quit().catch(() => { /* ignore */ });
  setImmediate(async () => {
    try {
      const analysis = await analyzePgn(pgn, 14);
      // Stamp scoring_version so the games list does not flag this analysis as
      // stale and re-trigger a free re-analysis on first view.
      db.prepare(`
        INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, estimated_elo_white, estimated_elo_black, moves_json, scoring_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET depth = excluded.depth,
          accuracy_white = excluded.accuracy_white, accuracy_black = excluded.accuracy_black,
          estimated_elo_white = excluded.estimated_elo_white, estimated_elo_black = excluded.estimated_elo_black,
          moves_json = excluded.moves_json, scoring_version = excluded.scoring_version
      `).run(gameId, 14, analysis.accuracy_white, analysis.accuracy_black, analysis.estimated_elo_white, analysis.estimated_elo_black, JSON.stringify(analysis.moves), SCORING_VERSION);
    } catch (err) {
      console.error('[auto-analyze]', err);
    }
  });
}

// ---- PVP GAME ----

interface GameDbRow {
  id: number; user_id: number; opponent_user_id: number | null;
  white: string; black: string;
  user_color: 'white' | 'black'; time_control: string;
  external_id: string; pgn: string;
  white_time_ms: number | null; black_time_ms: number | null; last_move_at: string | null;
}

// Persist clocks + last-move timestamp on every PvP move so a refresh / server
// restart can rehydrate the session without rolling clocks back to "initial"
// or, worse, gifting the opponent the time elapsed since their last move.
function persistPvpClocks(session: PvpSession): void {
  db.prepare(`UPDATE games SET white_time_ms = ?, black_time_ms = ?, last_move_at = ?, pgn = ?
              WHERE external_id = ?`)
    .run(session.whiteTimeMs, session.blackTimeMs, new Date(session.lastMoveAt).toISOString(),
         session.chess.pgn(), session.external_id);
}

async function handlePvpConnection(ws: WebSocket, user: AuthedUser, gameId: number) {
  // Resolve game (this user's perspective row)
  const row = db.prepare(`SELECT id, user_id, opponent_user_id, white, black, user_color, time_control, external_id, pgn, white_time_ms, black_time_ms, last_move_at FROM games WHERE id = ? AND user_id = ?`).get(gameId, user.id) as GameDbRow | undefined;
  if (!row) {
    send(ws, 'error', { message: 'game_not_found' });
    ws.close();
    return;
  }

  let session = pvpSessions.get(gameId);
  if (!session) {
    // Find paired (opponent's) game row to discover opponent user id
    const opponentId = row.opponent_user_id ?? null;
    if (!opponentId) {
      send(ws, 'error', { message: 'no_opponent' });
      ws.close();
      return;
    }
    const tcKey = row.time_control || 'untimed';
    const tc = TIME_CONTROLS[tcKey] ?? null;
    // Hydrate chess state from saved PGN if present (lets us resume after
    // a server restart or a F5 refresh in the middle of a game).
    const chess = new Chess();
    if (row.pgn && row.pgn.trim()) {
      try { chess.loadPgn(row.pgn, { strict: false }); } catch (err) { console.warn('[pvp] pgn restore failed', err); }
    }
    // Restore the running clocks so a refresh doesn't reset the game to its
    // initial time control. Charge the side-to-move for any wall time elapsed
    // since the last move was persisted — otherwise a player who refreshes
    // mid-think would gift their opponent that span. If the game has no saved
    // state yet (first connection on a fresh challenge), fall back to initial.
    let whiteMs = row.white_time_ms;
    let blackMs = row.black_time_ms;
    let lastMoveAt = row.last_move_at ? Date.parse(row.last_move_at) : NaN;
    if (whiteMs == null || blackMs == null || !Number.isFinite(lastMoveAt)) {
      whiteMs = tc?.initial ?? 0;
      blackMs = tc?.initial ?? 0;
      lastMoveAt = Date.now();
    } else if (tc) {
      const elapsed = Math.max(0, Date.now() - lastMoveAt);
      if (chess.turn() === 'w') whiteMs = Math.max(0, whiteMs - elapsed);
      else                       blackMs = Math.max(0, blackMs - elapsed);
      lastMoveAt = Date.now();
    }
    session = {
      kind: 'pvp',
      game_id: gameId,
      external_id: row.external_id,
      chess,
      white: row.user_color === 'white'
        ? { user_id: user.id, ws: null, display_name: row.white }
        : { user_id: opponentId, ws: null, display_name: row.white },
      black: row.user_color === 'black'
        ? { user_id: user.id, ws: null, display_name: row.black }
        : { user_id: opponentId, ws: null, display_name: row.black },
      timeControl: tc,
      whiteTimeMs: whiteMs,
      blackTimeMs: blackMs,
      lastMoveAt,
      saved: false,
      analysisEngine: null,
      analysisQueue: Promise.resolve(),
    };
    pvpSessions.set(gameId, session);
  }

  const myColor: 'white' | 'black' = row.user_color;
  const me: PvpPlayer = myColor === 'white' ? session.white : session.black;
  me.ws = ws;
  const opp: PvpPlayer = myColor === 'white' ? session.black : session.white;

  send(ws, 'pvp_hello', {
    game_id: gameId,
    fen: session.chess.fen(),
    your_color: myColor,
    you: { user_id: me.user_id, display_name: me.display_name },
    opponent: { user_id: opp.user_id, display_name: opp.display_name, online: !!opp.ws },
    time_control: row.time_control,
    whiteTimeMs: session.whiteTimeMs,
    blackTimeMs: session.blackTimeMs,
    history: session.chess.history(),
    turn: session.chess.turn(),
  });
  if (opp.ws) send(opp.ws, 'opponent_status', { online: true });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const type = msg.type as string;

    if (!session) return;

    try {
      if (type === 'move') {
        const uci = msg.uci as string;
        if (!uci || uci.length < 4) return;
        const turn = session.chess.turn();
        if ((turn === 'w' && me !== session.white) || (turn === 'b' && me !== session.black)) {
          send(ws, 'error', { message: 'not your turn' });
          return;
        }

        if (session.timeControl) {
          const elapsed = Date.now() - session.lastMoveAt;
          if (turn === 'w') session.whiteTimeMs -= elapsed; else session.blackTimeMs -= elapsed;
          if ((turn === 'w' ? session.whiteTimeMs : session.blackTimeMs) <= 0) {
            await endPvpGame(session, turn === 'w' ? '0-1' : '1-0', 'time');
            return;
          }
          if (turn === 'w') session.whiteTimeMs += session.timeControl.increment;
          else session.blackTimeMs += session.timeControl.increment;
          session.lastMoveAt = Date.now();
        }

        const move = session.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
        if (!move) { send(ws, 'error', { message: 'illegal move' }); return; }

        const payload = {
          type: 'move_made',
          fen: session.chess.fen(), san: move.san, uci, by: 'opponent',
          whiteTimeMs: session.whiteTimeMs, blackTimeMs: session.blackTimeMs,
        };
        // To opponent: the move came from "opponent". To self: came from "user".
        if (opp.ws) opp.ws.send(JSON.stringify(payload));
        send(ws, 'move_made', { ...payload, by: 'user' });

        // Persist clocks + PGN so a refresh on either side picks up exactly
        // here, charging only wall time elapsed since this update.
        try { persistPvpClocks(session); } catch (err) { console.warn('[pvp] persist failed', err); }

        if (await checkPvpGameOver(session)) return;
      } else if (type === 'preview_move') {
        const uci = msg.uci as string;
        if (!uci || uci.length < 4) return;
        const fenBefore = session.chess.fen();
        const probe = new Chess(fenBefore);
        const m = probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
        if (!m) { send(ws, 'preview_result', { ok: false, message: 'illegal' }); return; }
        const fenAfter = probe.fen();
        await runOnAnalysisEngine(session, async () => {
          try {
            const a = await ensureAnalysisEngine(session!);
            const result = await quickClassify({
              engine: a, fenBefore, fenAfter,
              moveUci: uci, depth: 10,
            });
            send(ws, 'preview_result', { ok: true, uci, ...result });
          } catch (err) {
            send(ws, 'preview_result', { ok: false, message: (err as Error).message });
          }
        });
      } else if (type === 'resign') {
        await endPvpGame(session, myColor === 'white' ? '0-1' : '1-0', 'resignation');
      } else if (type === 'request_hint') {
        const turn = session.chess.turn();
        const isMyTurn = (turn === 'w' && me === session.white) || (turn === 'b' && me === session.black);
        if (!isMyTurn) { send(ws, 'hint', { best_uci: null, error: 'not_your_turn' }); return; }
        const fen = session.chess.fen();
        await runOnAnalysisEngine(session, async () => {
          try {
            const a = await ensureAnalysisEngine(session!);
            const ev = await a.evaluate(fen, 12);
            send(ws, 'hint', { best_uci: ev.bestMoveUci, eval_cp: ev.cp });
          } catch (err) {
            send(ws, 'hint', { best_uci: null, error: (err as Error).message });
          }
        });
      }
    } catch (err) {
      send(ws, 'error', { message: err instanceof Error ? err.message : String(err) });
    }
  });

  ws.on('close', () => {
    if (!session) return;
    if (me.ws === ws) me.ws = null;
    if (opp.ws) send(opp.ws, 'opponent_status', { online: false });
    // If neither side connected and game not saved, keep session for reconnect (ephemeral)
    // GC: drop after a while if both gone — left simple for v1.
  });
}

async function checkPvpGameOver(session: PvpSession): Promise<boolean> {
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
  await endPvpGame(session, result, reason);
  return true;
}

async function endPvpGame(session: PvpSession, result: '1-0' | '0-1' | '1/2-1/2', reason: string) {
  if (session.saved) return;
  session.saved = true;
  const payload = { type: 'game_over', result, reason, fen: session.chess.fen() };
  if (session.white.ws) session.white.ws.send(JSON.stringify(payload));
  if (session.black.ws) session.black.ws.send(JSON.stringify(payload));

  session.chess.header('Event', 'Local PvP game');
  session.chess.header('White', session.white.display_name);
  session.chess.header('Black', session.black.display_name);
  session.chess.header('Result', result);
  session.chess.header('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
  const pgn = session.chess.pgn();

  // Update both DB rows (one per user) with PGN + result
  function userResult(color: 'white' | 'black'): 'win' | 'loss' | 'draw' {
    if (result === '1/2-1/2') return 'draw';
    if (result === '1-0') return color === 'white' ? 'win' : 'loss';
    return color === 'black' ? 'win' : 'loss';
  }
  const endTime = new Date().toISOString();
  db.prepare(`UPDATE games SET pgn = ?, result = ?, end_time = ? WHERE external_id = ? AND user_color = 'white'`)
    .run(pgn, userResult('white'), endTime, session.external_id);
  db.prepare(`UPDATE games SET pgn = ?, result = ?, end_time = ? WHERE external_id = ? AND user_color = 'black'`)
    .run(pgn, userResult('black'), endTime, session.external_id);

  // Notify both with their personal game id so they can navigate to review
  for (const color of ['white', 'black'] as const) {
    const player = color === 'white' ? session.white : session.black;
    const row = db.prepare(`SELECT id FROM games WHERE external_id = ? AND user_color = ?`).get(session.external_id, color) as { id: number } | undefined;
    if (player.ws && row) send(player.ws, 'game_saved', { game_id: row.id });
  }

  if (session.analysisEngine) session.analysisEngine.quit().catch(() => { /* ignore */ });
  pvpSessions.delete(session.game_id);

  // Background analyze for both rows
  setImmediate(async () => {
    try {
      const analysis = await analyzePgn(pgn, 14);
      const ids = db.prepare(`SELECT id FROM games WHERE external_id = ?`).all(session.external_id) as { id: number }[];
      for (const { id } of ids) {
        db.prepare(`
          INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black, estimated_elo_white, estimated_elo_black, moves_json, scoring_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id) DO UPDATE SET depth = excluded.depth,
            accuracy_white = excluded.accuracy_white, accuracy_black = excluded.accuracy_black,
            estimated_elo_white = excluded.estimated_elo_white, estimated_elo_black = excluded.estimated_elo_black,
            moves_json = excluded.moves_json, scoring_version = excluded.scoring_version
        `).run(id, 14, analysis.accuracy_white, analysis.accuracy_black, analysis.estimated_elo_white, analysis.estimated_elo_black, JSON.stringify(analysis.moves), SCORING_VERSION);
      }
      // Notify the still-connected sockets that analysis is ready
      for (const color of ['white', 'black'] as const) {
        const player = color === 'white' ? session.white : session.black;
        if (player.ws) send(player.ws, 'analysis_ready', {});
      }
    } catch (err) {
      console.error('[pvp-auto-analyze]', err);
    }
  });
}
