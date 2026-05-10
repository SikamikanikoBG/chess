import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trophy, Frown, Equal, BookOpen, Inbox, Settings as SettingsIcon } from 'lucide-react';
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
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1">{t('review.title')}</h1>
          <p className="page-sub">Browse, analyze and learn from your games.</p>
        </div>
        {user?.profile.chesscom_username ? (
          <button onClick={() => importMut.mutate()} disabled={importMut.isPending} className="btn-primary self-start sm:self-auto">
            <Download className="h-4 w-4" />
            {importMut.isPending ? t('review.importing') : `${t('review.import')} (@${user.profile.chesscom_username})`}
          </button>
        ) : (
          <Link to="/settings" className="btn-secondary text-sm">
            <SettingsIcon className="h-4 w-4" /> Set Chess.com username
          </Link>
        )}
      </header>

      {importMsg && (
        <div className="rounded-xl border border-accent-500/30 bg-accent-50/70 px-4 py-2 text-sm text-accent-700 dark:bg-accent-700/15 dark:text-accent-300">
          {importMsg}
        </div>
      )}

      {isLoading && (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card flex h-16 animate-pulse items-center gap-3 p-3">
              <div className="h-10 w-10 rounded-lg bg-ink-200 dark:bg-ink-700" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-1/3 rounded bg-ink-200 dark:bg-ink-700" />
                <div className="h-2 w-1/4 rounded bg-ink-100 dark:bg-ink-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && games.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-400 dark:bg-ink-800">
            <Inbox className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold">{t('review.noGames')}</div>
          {!user?.profile.chesscom_username && (
            <Link to="/settings" className="btn-secondary text-sm">
              <SettingsIcon className="h-4 w-4" /> {t('review.noUsername')}
            </Link>
          )}
        </div>
      )}

      {!isLoading && games.length > 0 && (
        <div className="grid gap-2">
          {games.map((g) => <GameCard key={g.id} g={g} />)}
        </div>
      )}
    </div>
  );
}

function GameCard({ g }: { g: GameRow }) {
  return (
    <Link to={`/review/${g.id}`} className="card-hover group flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <ResultIcon r={g.result} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className={`truncate font-semibold ${g.user_color === 'white' ? 'text-ink-900 dark:text-cream' : 'text-ink-700 dark:text-ink-200'}`}>{g.white}</span>
          <span className="text-ink-400">vs</span>
          <span className={`truncate font-semibold ${g.user_color === 'black' ? 'text-ink-900 dark:text-cream' : 'text-ink-700 dark:text-ink-200'}`}>{g.black}</span>
          <span className="text-[11px] text-ink-400">· {g.time_control}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-500">
          <span>{new Date(g.end_time).toLocaleDateString()}</span>
          <span>·</span>
          <span className="capitalize">{g.source}</span>
        </div>
      </div>
      {g.analyzed ? (
        <div className="text-right text-xs">
          <div className="text-[10px] uppercase tracking-wider text-ink-400">accuracy</div>
          <div className="font-mono text-sm font-semibold tabular-nums">
            <span className="text-ink-700 dark:text-ink-200">{fmtAccuracy(g.accuracy_white)}</span>
            <span className="mx-1 text-ink-400">/</span>
            <span className="text-ink-700 dark:text-ink-200">{fmtAccuracy(g.accuracy_black)}</span>
          </div>
        </div>
      ) : (
        <span className="badge gap-1 bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300">
          <BookOpen className="h-3 w-3" /> review
        </span>
      )}
    </Link>
  );
}

function ResultIcon({ r }: { r: string }) {
  if (r === 'win') return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-accent-700"><Trophy className="h-4 w-4" /></div>;
  if (r === 'loss') return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bad/10 text-bad"><Frown className="h-4 w-4" /></div>;
  return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300"><Equal className="h-4 w-4" /></div>;
}
