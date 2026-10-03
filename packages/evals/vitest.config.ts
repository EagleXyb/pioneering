import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// 评测包单测配置。
//
// '@pioneering/modu-agent' 在 workspace 未完整 npm install 的环境下
// （packages/evals/node_modules 无 link）无法按 Node 解析，故显式 alias 到
// 内核构建产物。消费内核前需先构建：`npm run build -w @pioneering/modu-agent`。
export default defineConfig({
  resolve: {
    alias: {
      '@pioneering/modu-agent': resolve(__dirname, '../modu-agent/dist/index.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
})
