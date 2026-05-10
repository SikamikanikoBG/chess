/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // v4.0.0 chess.com-style palette. The old cream/ink/accent palette is
        // kept as aliases so existing components don't break, but every page
        // that's been touched in the v4 rebrand uses the new tokens directly.
        chesscom: {
          50:  '#f7f6f5',
          100: '#ebe9e7',
          200: '#d6d2cd',
          300: '#a09a93',
          400: '#7d7670',
          500: '#5d5955',
          600: '#4b4744',
          700: '#3a3735',
          800: '#312e2b', // primary panel bg in dark mode
          900: '#262421', // top nav bg
          950: '#1a1816',
        },
        board: { dark: '#769656', light: '#eeeed2', dest: '#baca44' },
        gold: {
          50:  '#fffaeb',
          100: '#fff3c7',
          300: '#ffd766',
          500: '#ffc934',
          600: '#e6a700',
          700: '#a8780a',
        },
        panel: '#f1f1f0',
        hi:    '#e0c34a',

        // Legacy ink/cream palette — retained as aliases so v3 components
        // still render. New code should reach for `chesscom` / `panel` / `gold`.
        ink:    { 50: '#f8fafc', 100: '#eef1f6', 200: '#dbe1ea', 300: '#b8c2d2', 400: '#8b97ac', 500: '#5d6a82', 600: '#475063', 700: '#384053', 800: '#1f2536', 900: '#0e1320' },
        cream:  '#faf6ee',
        accent: { 50: '#ecfdf5', 100: '#d1fae5', 300: '#6ee7b7', 500: '#10b981', 600: '#059669', 700: '#047857' },
        warn:   '#f59e0b',
        bad:    '#ef4444',
        // Move classification colors — v4 retunes for chess.com fidelity.
        // Brilliant + Great stay near v3 (already correct);
        // Best/Excellent/Good shift to chess.com's olive/green family,
        // Miss flips from purple to red-orange (chess.com's actual color),
        // Book flips from slate to warm tan.
        move: {
          brilliant:  '#1baca6',
          great:      '#5b8baf',
          best:       '#81b64c',
          excellent:  '#95b776',
          good:       '#95a370',
          book:       '#a88865',
          inaccuracy: '#f7c045',
          mistake:    '#ffa459',
          blunder:    '#fa412d',
          miss:       '#ee6b55',
          forced:     '#6b6964',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        chess: ['"Noto Sans"', 'serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -6px rgba(15,23,42,0.08)',
        lift: '0 1px 2px rgba(15,23,42,0.05), 0 14px 40px -10px rgba(15,23,42,0.18)',
        glow: '0 0 0 1px rgba(255,201,52,0.4), 0 0 16px -2px rgba(255,201,52,0.35)',
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
          '0%':   { backgroundColor: 'rgba(255, 201, 52, 0.65)' },
          '100%': { backgroundColor: 'rgba(255, 201, 52, 0.42)' },
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
