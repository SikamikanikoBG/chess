// Insights page — chess.com-style "your weak spots" + per-phase accuracy roll-up.
// Templated headlines (no LLM) so the page renders instantly.

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, BarChart3, Target } from 'lucide-react';
import { api } from '../api';

interface InsightsData {
  games_analyzed: number;
  weak_spots: Array<{ key: string; count: number; pct: number; headline_en: string; headline_bg: string }>;
  phase_accuracy: { opening: number; middlegame: number; endgame: number };
}

export default function Insights() {
  const { i18n, t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['insights'],
    queryFn: () => api.get<InsightsData>('/api/insights?n=50'),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-7 w-40 rounded bg-chesscom-200 dark:bg-chesscom-700" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-24 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
          <div className="h-24 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
          <div className="h-24 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
        </div>
      </div>
    );
  }
  if (!data || data.games_analyzed === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center">
        <BarChart3 className="h-8 w-8 text-chesscom-400" />
        <div className="text-base font-semibold">{t('insights.empty', { defaultValue: 'No insights yet' })}</div>
        <div className="text-sm text-chesscom-500">{t('insights.emptyDesc', { defaultValue: 'Analyze a few games and your weak spots will show up here.' })}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-h1">{t('insights.title', { defaultValue: 'Insights' })}</h1>
        <p className="page-sub">{t('insights.sub', { defaultValue: 'Patterns across your last {{n}} analyzed games.', n: data.games_analyzed })}</p>
      </header>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-gold-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.phaseAccuracy', { defaultValue: 'Phase accuracy' })}</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <PhaseCard label={t('review.opening', { defaultValue: 'Opening' })} value={data.phase_accuracy.opening} />
          <PhaseCard label={t('review.middlegame', { defaultValue: 'Middlegame' })} value={data.phase_accuracy.middlegame} />
          <PhaseCard label={t('review.endgame', { defaultValue: 'Endgame' })} value={data.phase_accuracy.endgame} />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-mistake" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.weakSpots', { defaultValue: 'Your weak spots' })}</h2>
        </div>
        {data.weak_spots.length === 0 ? (
          <div className="card p-6 text-center text-sm text-chesscom-500">{t('insights.noWeak', { defaultValue: 'No clear pattern emerging — keep playing.' })}</div>
        ) : (
          <div className="space-y-2">
            {data.weak_spots.map((w) => (
              <div key={w.key} className="card flex items-start gap-3 p-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mistake/15 text-mistake">
                  <Activity className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{i18n.language === 'bg' ? w.headline_bg : w.headline_en}</div>
                  <div className="mt-0.5 text-[11px] text-chesscom-500">{w.count} cases · {Math.round(w.pct * 100)}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PhaseCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <div className="text-[10px] uppercase tracking-wide text-chesscom-500">{label}</div>
      <div className="font-mono text-2xl font-bold tabular-nums">{value.toFixed(1)}<span className="text-sm text-chesscom-400">%</span></div>
    </div>
  );
}
