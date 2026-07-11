import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), 'src')

// Resolves `./x.js` import specifiers (used throughout the TS source for ESM
// compatibility) to the actual `./x.ts` source files so vitest can run tests
// directly against `src/` without a prior build step. Also resolves the
// `@/...` alias (mapped to `src/...` in tsconfig) used by the test files in
// `tests/`.
function tsJsResolution(): any {
  return {
    name: 'ts-js-resolution',
    enforce: 'pre',
    resolveId(source: string, importer?: string): string | null {
      if (!importer) return null

      // `@/...` alias -> src/...
      const spec = source.startsWith('@/')
        ? resolve(srcDir, source.slice(2))
        : source

      // relative `./x.js` / `../x.js` -> `.ts`
      if (spec.startsWith('.') && spec.endsWith('.js')) {
        const tsPath = resolve(dirname(importer), spec.replace(/\.js$/, '.ts'))
        if (existsSync(tsPath)) return tsPath
      }

      // absolute (alias-resolved) `x.js` -> `.ts`
      if (!spec.startsWith('.') && spec.endsWith('.js')) {
        const tsPath = spec.replace(/\.js$/, '.ts')
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
  },
  plugins: [tsJsResolution()],
})
