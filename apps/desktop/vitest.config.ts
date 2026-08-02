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
    include: ['src/renderer/src/**/*.test.ts'],
    globals: true
  }
})
