import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './state/auth';
import Layout from './components/Layout';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Home from './pages/Home';
import SettingsPage from './pages/Settings';
import Play from './pages/Play';
import Review from './pages/Review';
import GameAnalyzer from './pages/GameAnalyzer';
import AdminUsers from './pages/admin/Users';
import AdminSystem from './pages/admin/System';

export default function App() {
  const { loading, setupRequired, user, refresh } = useAuth();
  const { i18n } = useTranslation();
  const location = useLocation();

  useEffect(() => { void refresh(); }, [refresh]);

  // Sync UI language with profile language whenever the user changes
  useEffect(() => {
    if (user?.profile?.language && user.profile.language !== i18n.language) {
      void i18n.changeLanguage(user.profile.language);
    }
  }, [user, i18n]);

  // Apply site theme (light / dark / auto) — toggles `dark` class on <html>
  useEffect(() => {
    const theme = user?.profile?.site_theme ?? 'auto';
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const wantDark = theme === 'dark' || (theme === 'auto' && mql.matches);
      document.documentElement.classList.toggle('dark', wantDark);
    };
    apply();
    if (theme === 'auto') {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    return undefined;
  }, [user?.profile?.site_theme]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">
        <div className="animate-pulse">♞</div>
      </div>
    );
  }

  if (setupRequired) {
    if (location.pathname !== '/setup') return <Navigate to="/setup" replace />;
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/play" element={<Play />} />
        <Route path="/review" element={<Review />} />
        <Route path="/review/:id" element={<GameAnalyzer />} />
        <Route path="/settings" element={<SettingsPage />} />
        {user.role === 'admin' && <Route path="/admin/users" element={<AdminUsers />} />}
        {user.role === 'admin' && <Route path="/admin/system" element={<AdminSystem />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
