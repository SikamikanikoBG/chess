import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles } from 'lucide-react';
import { Chess } from 'chess.js';
import ChessBoard from '../components/ChessBoard';
import EvalGraph from '../components/EvalGraph';
import MoveList from '../components/MoveList';
import CoachPanel from '../components/CoachPanel';
import { api } from '../api';
import { fmtAccuracy } from '../lib/utils';
import type { AnalysisResult, AnalyzedMove } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null };
  analysis: { depth: number; accuracy_white: number; accuracy_black: number; moves_json: string } | null;
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

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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

  // For coach explain
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

  // Suggested-move arrow
  const arrow = move?.best_move_uci && move.best_move_uci !== move.uci ? [{
    orig: move.best_move_uci.slice(0, 2) as never,
    dest: move.best_move_uci.slice(2, 4) as never,
    brush: 'paleBlue',
  }] : [];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/review" className="btn-ghost text-sm"><ChevronLeft className="h-4 w-4" />{t('common.back')}</Link>
        <div className="text-sm text-ink-500">
          <span className="font-medium text-ink-700 dark:text-ink-200">{data.game.white}</span> vs{' '}
          <span className="font-medium text-ink-700 dark:text-ink-200">{data.game.black}</span>
          <span className="ml-2">· {data.game.result}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto,1fr]">
        <div>
          <ChessBoard
            fen={pos?.fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
            orientation={orientation}
            lastMove={pos?.from && pos?.to ? [pos.from as never, pos.to as never] : undefined}
            arrows={arrow as never[]}
            size={520}
          />
          <div className="mt-3 flex justify-center gap-1">
            <button onClick={() => setPly(0)} className="btn-ghost p-2"><ChevronsLeft className="h-4 w-4" /></button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))} className="btn-ghost p-2"><ChevronLeft className="h-4 w-4" /></button>
            <span className="flex items-center px-3 text-sm tabular-nums text-ink-500">{ply} / {positions.length - 1}</span>
            <button onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))} className="btn-ghost p-2"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => setPly(positions.length - 1)} className="btn-ghost p-2"><ChevronsRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="space-y-4">
          {!analysis && (
            <button onClick={() => analyze(false)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing ? t('review.analyzing', { progress: '…' }) : t('review.analyze')}
            </button>
          )}

          {analysis && (
            <>
              <div className="card p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t('review.summary')}</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
                    <div className="text-xs text-ink-500">{t('review.white')}</div>
                    <div className="text-lg font-semibold tabular-nums">{fmtAccuracy(analysis.accuracy_white)}</div>
                  </div>
                  <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
                    <div className="text-xs text-ink-500">{t('review.black')}</div>
                    <div className="text-lg font-semibold tabular-nums">{fmtAccuracy(analysis.accuracy_black)}</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-400">{t('review.depth')}: {analysis.depth}</div>
              </div>

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

              {move && coachReq && (
                <CoachPanel systemConfigured={coachConfigured} request={coachReq} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
