/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Cyber-lab palette
        lab: {
          bg: '#070b16',
          panel: '#0d1424',
          panel2: '#111a2e',
          border: '#1e2b45',
          muted: '#7c8db5',
          text: '#e6edff',
        },
        neon: {
          cyan: '#22d3ee',
          green: '#34d399',
          lime: '#a3e635',
          amber: '#fbbf24',
          pink: '#f472b6',
          purple: '#a78bfa',
          red: '#f87171',
        },
        // Wordle tile states
        tile: {
          correct: '#3aa657',
          present: '#c9a227',
          absent: '#4b5563',
          empty: '#1f2937',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 20px -4px rgba(34, 211, 238, 0.5)',
        'neon-green': '0 0 20px -4px rgba(52, 211, 153, 0.5)',
      },
      keyframes: {
        'tile-pop': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '60%': { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'tile-flip': {
          '0%': { transform: 'rotateX(0deg)' },
          '50%': { transform: 'rotateX(90deg)' },
          '100%': { transform: 'rotateX(0deg)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'tile-pop': 'tile-pop 0.25s ease-out both',
        'tile-flip': 'tile-flip 0.4s ease-in-out both',
        'fade-in': 'fade-in 0.35s ease-out both',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
    },
  },
  plugins: [],
};
