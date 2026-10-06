import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/**
 * ESLint 最小门禁（P0-0.3）
 * - @eslint/js 推荐集
 * - typescript-eslint 推荐集（非 type-checked，保持轻量）
 * - react-hooks 推荐集（拦截 rules-of-hooks / 依赖数组违规）
 * - eslint-config-prettier 关闭与 Prettier 冲突的风格规则
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'dev-dist/**',
      // Node loader hook（CJS/ESM 解析 plumbing），不走浏览器侧 lint 规则
      'src/test/reactSingletonHooks.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 存量业务层（store/hooks/api）存在少量历史 any，P0 阶段先以 warn 可见不阻断，
      // 新代码应避免 any；后续重写页面逐页收敛后可提升为 error
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
    languageOptions: {
      // globals 14 未收录 vitest 全局，显式声明（与 vite.config test.globals 对应）
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
  prettier,
);
