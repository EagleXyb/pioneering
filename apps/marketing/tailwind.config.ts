import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0B0B10',
        card: '#1E1E23',
        'card-border': 'rgba(30,30,38,0.8)',
        'card-hover': '#252530',
        accent: {
          DEFAULT: '#5E6AD2',
          soft: 'rgba(94,106,210,0.13)',
          ight: 'rgba(94,106,210,0.10)',
        },
        green: {
          DEFAULT: '#22C55E',
          bg: 'rgba(34,197,94,0.13)',
        },
        amber: {
          DEFAULT: '#F59E0B',
          bg: 'rgba(245,158,11,0.13)',
        },
        red: {
          DEFAULT: '#EF4444',
          bg: 'rgba(239,68,68,0.13)',
        },
        'text-primary': '#F8FAFC',
        'text-muted': '#94A3B8',
        'text-muted2': '#64748B',
        'text-dim': '#475569',
        divider: '#1E293B',
        'progress-bg': '#232328',
      },
      fontFamily: {
        inter: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        noto: ['var(--font-noto-sans-sc)', "'PingFang SC'", "'Microsoft YaHei'", 'sans-serif'],
      },
      maxWidth: {
        page: '1440px',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
