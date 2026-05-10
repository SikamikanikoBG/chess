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
          brilliant:  '#22d3ee',  // cyan/teal
          great:      '#5b9bd5',  // chess.com "great move" blue
          best:       '#10b981',
          excellent:  '#34d399',
          good:       '#a3e635',
          book:       '#94a3b8',
          inaccuracy: '#fbbf24',
          mistake:    '#f97316',
          blunder:    '#ef4444',
          miss:       '#a855f7',   // purple — distinct from blunder
          forced:     '#64748b',   // muted slate — "no other move"
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        chess: ['"Noto Sans"', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -6px rgba(15,23,42,0.08)',
        lift: '0 1px 2px rgba(15,23,42,0.05), 0 14px 40px -10px rgba(15,23,42,0.18)',
        glow: '0 0 0 1px rgba(251,191,36,0.4), 0 0 16px -2px rgba(251,191,36,0.35)',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':       { opacity: '0.7', transform: 'scale(0.97)' },
        },
        'loader-slide': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'last-move-pulse': {
          '0%':   { backgroundColor: 'rgba(251, 191, 36, 0.55)' },
          '100%': { backgroundColor: 'rgba(251, 191, 36, 0.32)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'pulse-soft':     'pulse-soft 1.6s ease-in-out infinite',
        'loader-slide':   'loader-slide 1.4s ease-in-out infinite',
        'fade-in':        'fade-in 220ms ease-out',
        'last-move-pulse': 'last-move-pulse 360ms ease-out forwards',
        'shimmer':        'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
