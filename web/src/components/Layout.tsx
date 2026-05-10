import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Home, Swords, BookOpen, Settings as SettingsIcon, Users, Server, Menu, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';
import ChangelogModal from './ChangelogModal';

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    api.get<{ version: string }>('/api/meta')
      .then((d) => setVersion(d.version))
      .catch(() => setVersion(''));
  }, []);

  // Auto-close mobile drawer on route change
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  async function logout() {
    await api.post('/api/auth/logout');
    await refresh();
    nav('/login');
  }

  function NavItem({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
      <NavLink
        to={to}
        end
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'bg-ink-900 text-cream dark:bg-cream dark:text-ink-900'
              : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
          )
        }
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </NavLink>
    );
  }

  function NavContent() {
    return (
      <>
        <NavLink to="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="text-2xl">♞</span>
          <div>
            <div className="font-semibold text-ink-900 dark:text-cream">{t('app.name')}</div>
            <div className="text-xs text-ink-500">{t('app.tagline')}</div>
          </div>
        </NavLink>
        <nav className="space-y-1">
          <NavItem to="/" icon={Home} label={t('home.playTitle').split(' ')[0] === 'Play' ? 'Home' : 'Начало'} />
          <NavItem to="/play" icon={Swords} label={t('home.playTitle')} />
          <NavItem to="/review" icon={BookOpen} label={t('home.reviewTitle')} />
          <NavItem to="/settings" icon={SettingsIcon} label={t('common.settings')} />
          {user?.role === 'admin' && (
            <>
              <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide text-ink-400">{t('common.admin')}</div>
              <NavItem to="/admin/users" icon={Users} label={t('admin.users')} />
              <NavItem to="/admin/system" icon={Server} label={t('admin.system')} />
            </>
          )}
        </nav>
        <div className="mt-auto space-y-2 pt-6">
          <div className="flex items-center gap-2 rounded-xl bg-white p-2 dark:bg-ink-800">
            <span className="text-xl">{user?.profile.avatar_emoji ?? '♟'}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.profile.display_name}</div>
              <div className="truncate text-xs text-ink-500">@{user?.username}</div>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => i18n.changeLanguage('en')}
              className={cn('btn-ghost flex-1 px-2 py-1 text-xs', i18n.language === 'en' && 'bg-ink-100 dark:bg-ink-800')}
            >EN</button>
            <button
              onClick={() => i18n.changeLanguage('bg')}
              className={cn('btn-ghost flex-1 px-2 py-1 text-xs', i18n.language === 'bg' && 'bg-ink-100 dark:bg-ink-800')}
            >BG</button>
          </div>
          <button onClick={logout} className="btn-ghost w-full justify-start">
            <LogOut className="h-4 w-4" />
            {t('common.logout')}
          </button>
          {version && (
            <button
              onClick={() => setShowChangelog(true)}
              className="block w-full text-center text-[11px] text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
              title="View changelog"
            >
              v{version}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200 bg-cream p-4 dark:border-ink-800 dark:bg-ink-900 md:flex">
        <NavContent />
      </aside>

      {/* Mobile drawer */}
      {navOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-cream p-4 dark:bg-ink-900 md:hidden">
            <button onClick={() => setNavOpen(false)} className="btn-ghost mb-2 self-end p-1.5">
              <X className="h-5 w-5" />
            </button>
            <NavContent />
          </aside>
        </>
      )}

      <main className="min-w-0 flex-1">
        {/* Mobile header */}
        <header className="flex items-center justify-between border-b border-ink-200 bg-cream px-3 py-2 dark:border-ink-800 dark:bg-ink-900 md:hidden">
          <button onClick={() => setNavOpen(true)} className="btn-ghost p-2">
            <Menu className="h-5 w-5" />
          </button>
          <NavLink to="/" className="flex items-center gap-2">
            <span className="text-xl">♞</span>
            <span className="font-semibold">{t('app.name')}</span>
          </NavLink>
          <button onClick={logout} className="btn-ghost p-2"><LogOut className="h-4 w-4" /></button>
        </header>
        <div className="p-3 sm:p-6">
          <Outlet />
        </div>
      </main>

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
