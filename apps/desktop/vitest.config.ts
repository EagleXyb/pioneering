import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// 纯函数单测（chatStore 流式落盘、trace-builder 等）不需要 DOM，
// 使用 node 环境，复用与 electron.vite.config 一致的路径别名。
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    // 覆盖 renderer 与 main：main 侧（agent-runtime 等）为纯函数/结构接口实现，
    // 不依赖 Electron 运行时，可直接在 node 环境断言（内核经 vi.mock 隔离）。
    include: ['src/**/*.test.ts'],
    globals: true
  }
})
