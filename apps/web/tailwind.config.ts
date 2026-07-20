import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind 配置 —— 仅服务于任务模式的 shadcn/ui 组件
 *
 * 隔离策略：
 * 1. corePlugins.preflight = false：关闭全局 reset，避免污染 TDesign 与其他模式
 * 2. content 仅扫描任务模式相关文件：未引用的 utility 不会生成 CSS
 * 3. important: '.tw-scope'：所有 utility 自动包裹 .tw-scope 祖先选择器，
 *    即便类名（如 flex）匹配其他模式元素，也不会生效
 * 4. darkMode 不依赖 .dark 类：shadcn 变量直接映射到现有 tokens.css 变量，
 *    tokens.css 已通过 [data-theme="dark"] 与 prefers-color-scheme 处理暗色
 */
export default {
  content: [
    'src/modes/task/**/*.{ts,tsx}',
    'src/layout/TaskTopBar/**/*.{ts,tsx}',
    'src/components/ui/**/*.{ts,tsx}',
  ],
  important: '.tw-scope',
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
