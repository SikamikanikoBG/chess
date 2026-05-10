import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Swords, BookOpen, Settings as SettingsIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../state/auth';

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const cards = [
    { to: '/play', icon: Swords, title: t('home.playTitle'), desc: t('home.playDesc'), color: 'from-accent-500 to-emerald-700' },
    { to: '/review', icon: BookOpen, title: t('home.reviewTitle'), desc: t('home.reviewDesc'), color: 'from-amber-500 to-orange-700' },
    { to: '/settings', icon: SettingsIcon, title: t('home.settingsTitle'), desc: t('home.settingsDesc'), color: 'from-slate-500 to-slate-800' },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <motion.h1
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-3xl font-bold"
      >
        {t('home.greeting', { name: user?.profile.display_name ?? '' })}
      </motion.h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c, i) => (
          <motion.div key={c.to}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * (i + 1) }}
          >
            <Link to={c.to}
              className="group block overflow-hidden rounded-2xl bg-white shadow-soft transition-transform hover:-translate-y-0.5 hover:shadow-lg dark:bg-ink-800"
            >
              <div className={`h-32 bg-gradient-to-br ${c.color} p-6 text-white/95`}>
                <c.icon className="h-10 w-10 opacity-90 transition-transform group-hover:scale-110" />
              </div>
              <div className="p-5">
                <div className="text-lg font-semibold">{c.title}</div>
                <div className="text-sm text-ink-500 dark:text-ink-300">{c.desc}</div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
