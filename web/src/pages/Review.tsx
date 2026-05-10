import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trophy, Frown, Equal } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { fmtAccuracy } from '../lib/utils';
import type { GameRow } from '../types';

export default function Review() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<{ games: GameRow[] }>('/api/games?limit=100'),
  });

  const importMut = useMutation({
    mutationFn: () => api.post<{ imported: number; total: number }>('/api/games/import/chesscom', { limit: 20 }),
    onSuccess: (r) => {
      setImportMsg(t('review.imported', { n: r.imported }));
      qc.invalidateQueries({ queryKey: ['games'] });
      setTimeout(() => setImportMsg(null), 3000);
    },
  });

  const games = data?.games ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="text-2xl font-bold">{t('review.title')}</h1>
        {user?.profile.chesscom_username ? (
          <button onClick={() => importMut.mutate()} disabled={importMut.isPending} className="btn-primary">
            <Download className="h-4 w-4" />
            {importMut.isPending ? t('review.importing') : `${t('review.import')} (@${user.profile.chesscom_username})`}
          </button>
        ) : (
          <Link to="/settings" className="btn-secondary text-sm">{t('review.noUsername')}</Link>
        )}
      </div>

      {importMsg && <div className="mb-4 rounded-lg bg-accent-50 px-4 py-2 text-sm text-accent-700 dark:bg-accent-700/20 dark:text-accent-300">{importMsg}</div>}

      {isLoading && <div className="text-ink-500">{t('common.loading')}</div>}

      {!isLoading && games.length === 0 && (
        <div className="card p-12 text-center text-ink-500">{t('review.noGames')}</div>
      )}

      <div className="grid gap-2">
        {games.map((g) => (
          <Link key={g.id} to={`/review/${g.id}`}
            className="group flex items-center gap-4 rounded-xl bg-white p-3 shadow-soft transition-colors hover:bg-ink-50 dark:bg-ink-800 dark:hover:bg-ink-700">
            <ResultIcon r={g.result} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {g.user_color === 'white' ? `${g.white} vs ${g.black}` : `${g.white} vs ${g.black}`}
                <span className="ml-2 text-xs text-ink-400">{g.time_control}</span>
              </div>
              <div className="text-xs text-ink-500">{new Date(g.end_time).toLocaleString()}</div>
            </div>
            {g.analyzed ? (
              <div className="text-right text-xs">
                <div className="text-ink-400">{t('review.accuracy')}</div>
                <div className="font-mono font-semibold">
                  <span className="text-ink-700 dark:text-ink-200">{fmtAccuracy(g.accuracy_white)}</span>
                  <span className="mx-1 text-ink-400">/</span>
                  <span className="text-ink-700 dark:text-ink-200">{fmtAccuracy(g.accuracy_black)}</span>
                </div>
              </div>
            ) : (
              <span className="badge bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300">{t('review.analyze')}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ResultIcon({ r }: { r: string }) {
  if (r === 'win') return <div className="rounded-lg bg-accent-100 p-2 text-accent-700"><Trophy className="h-4 w-4" /></div>;
  if (r === 'loss') return <div className="rounded-lg bg-bad/10 p-2 text-bad"><Frown className="h-4 w-4" /></div>;
  return <div className="rounded-lg bg-ink-100 p-2 text-ink-500 dark:bg-ink-700 dark:text-ink-300"><Equal className="h-4 w-4" /></div>;
}
