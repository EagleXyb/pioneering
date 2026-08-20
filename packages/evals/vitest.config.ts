// vitest 配置：直接跑 src/ 源码（无需先 build）。
//
// 关键点：
//   1. `@pioneering/modu-agent` alias 到 monorepo 兄弟包源码
//      （packages/modu-agent/src/index.ts），测试无需依赖其 dist 产物。
//   2. modu-agent 源码内部使用 `.js` 后缀的 ESM 导入风格（tsc 编译约定），
//      vitest 无法直接解析，需要 resolveId 插件将 `./x.js` 重写为 `./x.ts`
//      （与 modu-agent 包自身的 vitest.config.ts 保持一致）。
import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = dirname(fileURLToPath(import.meta.url))
const moduAgentSrc = resolve(pkgRoot, '../modu-agent/src')

function tsJsResolution(): any {
  return {
    name: 'ts-js-resolution',
    enforce: 'pre',
    resolveId(source: string, importer?: string): string | null {
      if (!importer) return null
      if (!source.endsWith('.js')) return null

      // 相对导入：./x.js / ../x.js -> 同目录 .ts
      if (source.startsWith('.')) {
        const tsPath = resolve(dirname(importer), source.replace(/\.js$/, '.ts'))
        if (existsSync(tsPath)) return tsPath
        // 兜底：index.ts（目录导入）
        const idxPath = resolve(tsPath, 'index.ts')
        if (existsSync(`${tsPath}/index.ts`)) return `${tsPath}/index.ts`
      }

      // 包内绝对/别名导入：x.js -> x.ts（相对 modu-agent src 根）
      if (!source.startsWith('.')) {
        const tsPath = resolve(moduAgentSrc, source.replace(/\.js$/, '.ts'))
        if (existsSync(tsPath)) return tsPath
      }
      return null
    },
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 数据集/配置加载测试涉及文件 IO，放宽超时
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@pioneering/modu-agent': resolve(moduAgentSrc, 'index.ts'),
    },
  },
  plugins: [tsJsResolution()],
})
