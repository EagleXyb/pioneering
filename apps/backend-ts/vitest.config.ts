import { defineConfig } from 'vitest/config';

// 注意：test/*.mjs 是独立的 e2e / 管道脚本（直接用 node 运行，依赖 LLM key
// 或在线服务，文件内使用 process.exit），不属于 vitest 套件，故此处只纳入 .ts。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
