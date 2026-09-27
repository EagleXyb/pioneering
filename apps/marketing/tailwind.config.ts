import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 中性近黑体系（对齐 Apple 深色页：无蓝紫色偏）
        bg: '#161617',
        card: '#1F1F21',
        'card-border': 'rgba(255,255,255,0.09)',
        accent: {
          DEFAULT: '#0A84FF',
          soft: 'rgba(10,132,255,0.14)',
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
        'text-primary': '#F5F5F7',
        'text-muted': '#98989D',
        'text-muted2': '#6E6E73',
        'text-dim': '#48484A',
        divider: '#2C2C2E',
        'progress-bg': '#2C2C2E',
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'system-ui',
          '-apple-system',
          "'PingFang SC'",
          "'Hiragino Sans GB'",
          "'Microsoft YaHei'",
          'sans-serif',
        ],
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
