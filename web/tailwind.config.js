/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Cozy chessy palette — warm cream + deep slate, with mint accents
        ink:    { 50: '#f8fafc', 100: '#eef1f6', 200: '#dbe1ea', 300: '#b8c2d2', 400: '#8b97ac', 500: '#5d6a82', 600: '#475063', 700: '#384053', 800: '#1f2536', 900: '#0e1320' },
        cream:  '#faf6ee',
        accent: { 50: '#ecfdf5', 100: '#d1fae5', 300: '#6ee7b7', 500: '#10b981', 600: '#059669', 700: '#047857' },
        warn:   '#f59e0b',
        bad:    '#ef4444',
        // Move classification colors
        move: {
          best: '#10b981',
          excellent: '#34d399',
          good: '#a3e635',
          book: '#94a3b8',
          inaccuracy: '#fbbf24',
          mistake: '#f97316',
          blunder: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        chess: ['"Noto Sans"', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.10)',
      },
    },
  },
  plugins: [],
};
