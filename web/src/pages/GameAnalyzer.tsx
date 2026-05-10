import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles, Trophy } from 'lucide-react';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachPanel from '../components/CoachPanel';
import { api } from '../api';
import { fmtAccuracy } from '../lib/utils';
import type { AnalysisResult, AnalyzedMove } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null };
  analysis: {
    depth: number; accuracy_white: number; accuracy_black: number;
    estimated_elo_white: number | null; estimated_elo_black: number | null;
    moves_json: string;
  } | null;
}

function fmtCp(cp: number | null | undefined): string {
  if (cp == null) return '0.00';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

export default function GameAnalyzer() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const gameId = Number(id);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => api.get<GameDetail>(`/api/games/${gameId}`),
    enabled: !!gameId,
  });

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [coachConfigured, setCoachConfigured] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (data.analysis) {
      setAnalysis({
        depth: data.analysis.depth,
        accuracy_white: data.analysis.accuracy_white,
        accuracy_black: data.analysis.accuracy_black,
        estimated_elo_white: data.analysis.estimated_elo_white,
        estimated_elo_black: data.analysis.estimated_elo_black,
        moves: JSON.parse(data.analysis.moves_json),
      });
    } else {
      setAnalysis(null);
    }
  }, [data]);

  useEffect(() => {
    api.get<{ configured: boolean }>('/api/coach/status')
      .then((s) => setCoachConfigured(s.configured))
      .catch(() => setCoachConfigured(false));
  }, []);

  // Build position list from PGN
  const positions = useMemo(() => {
    if (!data) return [];
    const chess = new Chess();
    chess.loadPgn(data.game.pgn, { strict: false });
    const history = chess.history({ verbose: true });
    const replay = new Chess();
    const list: { fen: string; san?: string; from?: string; to?: string }[] = [{ fen: replay.fen() }];
    for (const m of history) {
      replay.move({ from: m.from, to: m.to, promotion: m.promotion });
      list.push({ fen: replay.fen(), san: m.san, from: m.from, to: m.to });
    }
    return list;
  }, [data]);

  const [ply, setPly] = useState(0);

  // Reset to start when game changes
  useEffect(() => { setPly(0); }, [gameId]);

  // Keyboard navigation (disabled when typing in inputs)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(positions.length - 1, p + 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(positions.length - 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [positions.length]);

  async function analyze(force = false) {
    setAnalyzing(true);
    try {
      const r = await api.post<{ analysis: AnalysisResult; cached: boolean }>('/api/analyze', { game_id: gameId, depth: 16, force });
      setAnalysis(r.analysis);
      await refetch();
    } finally {
      setAnalyzing(false);
    }
  }

  if (isLoading || !data) return <div className="p-6 text-ink-500">{t('common.loading')}</div>;

  const pos = positions[ply] ?? positions[0];
  const move: AnalyzedMove | undefined = analysis?.moves[ply - 1];
  const userColor = data.game.user_color ?? 'white';
  const orientation = userColor;
  const currentEvalCp = move?.eval_after_cp ?? 0;

  // Coach request — only fires when there's a played move at this ply
  const coachReq = move ? () => ({
    url: '/api/coach/explain',
    body: {
      fen: move.fen_before,
      player: ply % 2 === 1 ? 'White' : 'Black',
      played_san: move.san,
      best_san: move.best_move_san,
      classification: move.classification,
      cp_loss: move.centipawn_loss,
      pv_san: move.best_pv,
    },
  }) : null;

  // Suggested-move arrow (engine recommendation, when different from played)
  const arrow = move?.best_move_uci && move.best_move_uci !== move.uci ? [{
    orig: move.best_move_uci.slice(0, 2) as never,
    dest: move.best_move_uci.slice(2, 4) as never,
    brush: 'paleBlue',
  }] : [];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link to="/review" className="btn-ghost text-sm shrink-0"><ChevronLeft className="h-4 w-4" />{t('common.back')}</Link>
        <div className="min-w-0 truncate text-right text-sm text-ink-500">
          <span className="font-medium text-ink-700 dark:text-ink-200">{data.game.white}</span> vs{' '}
          <span className="font-medium text-ink-700 dark:text-ink-200">{data.game.black}</span>
          <span className="ml-2">· {data.game.result}</span>
        </div>
      </div>

      {/* Main grid: board on top (mobile) or left (desktop), panel below/right */}
      <div className="grid gap-4 lg:grid-cols-[auto,1fr] lg:gap-6">
        {/* Board section */}
        <div className="mx-auto w-full max-w-[560px] lg:mx-0">
          <div className="flex items-stretch gap-2">
            <EvalBar cp={currentEvalCp} orientation={orientation} />
            <div className="min-w-0 flex-1">
              <ChessBoard
                fen={pos?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
                orientation={orientation}
                lastMove={pos?.from && pos?.to ? [pos.from as never, pos.to as never] : undefined}
                arrows={arrow as never[]}
              />
            </div>
          </div>
          {/* Score readout below board */}
          <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-soft dark:bg-ink-800">
            <div className="text-ink-500">
              {move ? (
                <>
                  <span className="font-medium text-ink-900 dark:text-cream">{ply % 2 === 1 ? 'W' : 'B'}: {move.san}</span>
                  {move.best_move_san && move.best_move_san !== move.san && (
                    <span className="ml-2 text-xs text-ink-400">best: {move.best_move_san}</span>
                  )}
                </>
              ) : <span className="italic">starting position</span>}
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">
              {fmtCp(currentEvalCp)}
            </div>
          </div>
          {/* Nav controls */}
          <div className="mt-2 flex justify-center gap-1">
            <button onClick={() => setPly(0)} className="btn-ghost p-2"><ChevronsLeft className="h-4 w-4" /></button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))} className="btn-ghost p-2"><ChevronLeft className="h-4 w-4" /></button>
            <span className="flex items-center px-3 text-sm tabular-nums text-ink-500">{ply} / {positions.length - 1}</span>
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} className="btn-ghost p-2"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => setPly(positions.length - 1)} className="btn-ghost p-2"><ChevronsRight className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-3">
          {!analysis && (
            <button onClick={() => analyze(false)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing ? t('review.analyzing', { progress: '…' }) : t('review.analyze')}
            </button>
          )}

          {analysis && (
            <>
              <SummaryCard
                accuracyW={analysis.accuracy_white}
                accuracyB={analysis.accuracy_black}
                eloW={analysis.estimated_elo_white}
                eloB={analysis.estimated_elo_black}
                depth={analysis.depth}
                whiteName={data.game.white}
                blackName={data.game.black}
              />

              {/* Always-on coach in review (with mute toggle) */}
              {coachReq && (
                <CoachPanel
                  systemConfigured={coachConfigured}
                  request={coachReq}
                  autoPlay
                  triggerKey={ply}
                  debounceMs={700}
                />
              )}

              <div className="card p-2">
                <EvalGraph
                  evals={analysis.moves.map((m) => ({ ply: m.ply, cp: m.eval_after_cp }))}
                  current={ply}
                  onClick={(p) => setPly(p)}
                />
              </div>

              <MoveList
                moves={analysis.moves.map((m) => ({ ply: m.ply, san: m.san, classification: m.classification }))}
                current={ply}
                onSelect={setPly}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  accuracyW, accuracyB, eloW, eloB, depth, whiteName, blackName,
}: {
  accuracyW: number; accuracyB: number;
  eloW: number | null; eloB: number | null;
  depth: number; whiteName: string; blackName: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('review.summary')}</h3>
      <div className="grid grid-cols-2 gap-2">
        <PlayerCell label={t('review.white')} name={whiteName} accuracy={accuracyW} elo={eloW} side="white" />
        <PlayerCell label={t('review.black')} name={blackName} accuracy={accuracyB} elo={eloB} side="black" />
      </div>
      <div className="mt-2 text-[11px] text-ink-400">
        {t('review.depth')}: {depth} · Elo is an estimate from this game's accuracy
      </div>
    </div>
  );
}

function PlayerCell({ label, name, accuracy, elo, side }: { label: string; name: string; accuracy: number; elo: number | null; side: 'white' | 'black' }) {
  const dot = side === 'white' ? 'bg-cream border border-ink-300' : 'bg-ink-900';
  return (
    <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${dot}`} />
        <span className="text-xs text-ink-500">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium">{name}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-ink-400">Accuracy</div>
          <div className="font-mono text-base font-semibold tabular-nums">{fmtAccuracy(accuracy)}</div>
        </div>
        {elo != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-400 flex items-center gap-1">
              <Trophy className="h-3 w-3" /> Est. Elo
            </div>
            <div className="font-mono text-base font-semibold tabular-nums">{elo}</div>
          </div>
        )}
      </div>
    </div>
  );
}
