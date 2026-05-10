import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Flag, Lightbulb } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ChessBoard from '../components/ChessBoard';
import CoachPanel from '../components/CoachPanel';
import { useAuth } from '../state/auth';
import { fmtClock } from '../lib/utils';
import { api } from '../api';
import type { Difficulty } from '../types';

const DIFFICULTIES: Difficulty[] = ['kid','beginner','easy','medium','hard','master','stockfish'];
const TIME_CONTROLS = ['untimed','bullet','blitz','rapid','classical'] as const;

interface Move { ply: number; san: string; uci: string }
interface ServerMsg {
  type: string;
  fen?: string;
  san?: string;
  uci?: string;
  by?: 'user' | 'engine';
  whiteTimeMs?: number;
  blackTimeMs?: number;
  result?: '1-0' | '0-1' | '1/2-1/2';
  reason?: string;
  game_id?: number;
  best_uci?: string;
  message?: string;
}

export default function Play() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();

  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [color, setColor] = useState<'white' | 'black' | 'random'>('white');
  const [tc, setTc] = useState<typeof TIME_CONTROLS[number]>('untimed');

  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [moves, setMoves] = useState<Move[]>([]);
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  const [whiteMs, setWhiteMs] = useState(0);
  const [blackMs, setBlackMs] = useState(0);
  const [result, setResult] = useState<{ result: string; reason: string; gameId?: number } | null>(null);
  const [coachConfigured, setCoachConfigured] = useState(false);
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    api.get<{ configured: boolean }>('/api/coach/status')
      .then((s) => setCoachConfigured(s.configured))
      .catch(() => setCoachConfigured(false));
  }, []);

  // Local clock animation
  useEffect(() => {
    if (phase !== 'playing' || tc === 'untimed') return;
    const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
    const id = window.setInterval(() => {
      if (turn === 'white') setWhiteMs((m) => Math.max(0, m - 100));
      else setBlackMs((m) => Math.max(0, m - 100));
    }, 100);
    tickRef.current = id;
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [phase, fen, tc]);

  function start() {
    const finalColor = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color;
    setUserColor(finalColor);
    setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    setMoves([]);
    setResult(null);
    setHint(null);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/play`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'new_game',
        difficulty,
        color: finalColor,
        time_control: tc,
      }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMsg;
      if (msg.type === 'game_started' && msg.fen !== undefined) {
        setPhase('playing');
        setFen(msg.fen);
        if (msg.whiteTimeMs !== undefined) setWhiteMs(msg.whiteTimeMs);
        if (msg.blackTimeMs !== undefined) setBlackMs(msg.blackTimeMs);
      } else if (msg.type === 'move_made' && msg.fen) {
        setFen(msg.fen);
        if (msg.san && msg.uci) {
          setMoves((m) => [...m, { ply: m.length + 1, san: msg.san!, uci: msg.uci! }]);
        }
        if (msg.whiteTimeMs !== undefined) setWhiteMs(msg.whiteTimeMs);
        if (msg.blackTimeMs !== undefined) setBlackMs(msg.blackTimeMs);
        if (msg.by === 'engine') setThinking(false);
        if (msg.by === 'user') setThinking(true);
        setHint(null);
      } else if (msg.type === 'game_over' && msg.result) {
        setPhase('over');
        setResult({ result: msg.result, reason: msg.reason ?? '' });
      } else if (msg.type === 'game_saved' && msg.game_id) {
        setResult((r) => r ? { ...r, gameId: msg.game_id } : r);
      } else if (msg.type === 'hint' && msg.best_uci) {
        setHint({ from: msg.best_uci.slice(0, 2), to: msg.best_uci.slice(2, 4) });
      }
    };
    ws.onclose = () => { /* ignore */ };
  }

  function sendMove(uci: string) {
    setThinking(true);
    wsRef.current?.send(JSON.stringify({ type: 'move', uci }));
  }
  function resign() { wsRef.current?.send(JSON.stringify({ type: 'resign' })); }
  function requestHint() { wsRef.current?.send(JSON.stringify({ type: 'request_hint' })); }

  const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const movable = phase === 'playing' && turn === userColor;

  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold">{t('play.newGame')}</h1>

        <div className="card space-y-6 p-6">
          <div>
            <div className="label mb-2">{t('play.difficulty')}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DIFFICULTIES.map((d) => (
                <button key={d} onClick={() => setDifficulty(d)}
                  className={`rounded-xl border p-3 text-left transition-colors
                    ${difficulty === d
                      ? 'border-ink-900 bg-ink-900 text-cream dark:border-cream dark:bg-cream dark:text-ink-900'
                      : 'border-ink-200 bg-white hover:border-ink-300 dark:border-ink-700 dark:bg-ink-800 dark:hover:border-ink-600'}`}>
                  <div className="text-sm font-semibold">{t(`play.diff.${d}`)}</div>
                  <div className={`mt-1 text-xs ${difficulty === d ? 'opacity-80' : 'text-ink-500'}`}>{t(`play.diffDesc.${d}`)}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label mb-2">{t('play.color')}</div>
            <div className="grid grid-cols-3 gap-2">
              {(['white','random','black'] as const).map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`btn ${color === c ? 'btn-primary' : 'btn-secondary'}`}>
                  {t(`play.${c}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label mb-2">{t('play.timeControl')}</div>
            <div className="flex flex-wrap gap-2">
              {TIME_CONTROLS.map((t2) => (
                <button key={t2} onClick={() => setTc(t2)}
                  className={`btn ${tc === t2 ? 'btn-primary' : 'btn-secondary'}`}>
                  {t(`play.tc.${t2}`)}
                </button>
              ))}
            </div>
          </div>

          <button onClick={start} className="btn-primary w-full text-base">
            {t('play.start')}
          </button>
        </div>
      </div>
    );
  }

  const showAlwaysCoach = user?.profile.coach_behavior === 'always_on_pedagogical' && coachConfigured;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-4 lg:grid-cols-[auto,1fr] lg:gap-6">
        <div className="mx-auto w-full max-w-[560px] lg:mx-0">
          <ClockBar timeMs={userColor === 'white' ? blackMs : whiteMs} active={turn !== userColor} label={userColor === 'white' ? t('play.black') : t('play.white')} flip />
          <div className="my-2">
            <ChessBoard
              fen={fen}
              orientation={userColor}
              movable={movable}
              turnColor={turn}
              onMove={sendMove}
              arrows={hint ? [{ orig: hint.from as never, dest: hint.to as never, brush: 'paleGreen' }] : []}
            />
          </div>
          <ClockBar timeMs={userColor === 'white' ? whiteMs : blackMs} active={turn === userColor} label={userColor === 'white' ? t('play.white') : t('play.black')} />
        </div>

        <div className="space-y-3">
          {phase === 'playing' && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-ink-500">
                {turn === userColor ? <span className="font-medium text-accent-600">{t('play.yourTurn')}</span> : t('play.thinking')}
              </div>
              <div className="flex gap-2">
                <button onClick={requestHint} className="btn-secondary text-sm"><Lightbulb className="h-4 w-4" />{t('play.hint')}</button>
                <button onClick={resign} className="btn-danger text-sm"><Flag className="h-4 w-4" />{t('play.resign')}</button>
              </div>
            </div>
          )}

          <div className="card max-h-72 overflow-auto p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('review.moves')}</h3>
            <MovesList moves={moves} />
          </div>

          {showAlwaysCoach && (
            <CoachPanel
              systemConfigured={coachConfigured}
              autoPlay
              triggerKey={moves.length}
              request={() => moves.length > 0 ? ({
                url: '/api/coach/hint',
                body: { fen },
              }) : ({
                url: '/api/coach/hint',
                body: { fen },
              })}
            />
          )}

          <AnimatePresence>
            {phase === 'over' && result && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                className="card p-6 text-center"
              >
                <div className="mb-2 text-3xl">
                  {result.result === '1/2-1/2' ? '½ ½'
                    : (result.result === '1-0' && userColor === 'white') || (result.result === '0-1' && userColor === 'black') ? '🏆'
                    : '🤝'}
                </div>
                <div className="text-xl font-bold">
                  {result.result === '1/2-1/2' ? t('play.result.draw')
                    : (result.result === '1-0' && userColor === 'white') || (result.result === '0-1' && userColor === 'black') ? t('play.result.win')
                    : t('play.result.loss')}
                </div>
                <div className="mt-1 text-sm text-ink-500">{t(`play.reason.${result.reason}`, { defaultValue: result.reason })}</div>
                <div className="mt-4 flex justify-center gap-2">
                  <button onClick={() => setPhase('setup')} className="btn-secondary">{t('play.playAgain')}</button>
                  {result.gameId && (
                    <button onClick={() => nav(`/review/${result.gameId}`)} className="btn-primary">{t('play.review')}</button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ClockBar({ timeMs, active, label, flip }: { timeMs: number; active: boolean; label: string; flip?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-xl px-4 py-2 transition-colors
      ${active ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300'} ${flip ? '' : ''}`}>
      <span className="text-xs font-medium uppercase">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{fmtClock(timeMs)}</span>
    </div>
  );
}

function MovesList({ moves }: { moves: Move[] }) {
  const rows: { num: number; w?: string; b?: string }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ num: i / 2 + 1, w: moves[i]?.san, b: moves[i + 1]?.san });
  }
  if (rows.length === 0) return <div className="text-sm text-ink-400">—</div>;
  return (
    <div className="grid grid-cols-[auto,1fr,1fr] gap-x-3 gap-y-1 text-sm">
      {rows.flatMap((r) => [
        <span key={`n${r.num}`} className="text-ink-400">{r.num}.</span>,
        <span key={`w${r.num}`}>{r.w ?? ''}</span>,
        <span key={`b${r.num}`}>{r.b ?? ''}</span>,
      ])}
    </div>
  );
}
