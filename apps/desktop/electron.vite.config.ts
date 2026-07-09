import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        // H1: 输出 CommonJS（index.cjs）而非 ESM。
        // 原因：Electron 沙箱模式（sandbox:true）要求 preload 必须是
        // CommonJS 模块，ESM preload 在 sandbox 下会报
        // "Cannot use import statement outside a module" 导致 window.api 丢失。
        // 改 CJS 后即可在 main/index.ts 中重开 sandbox:true。
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
          chunkFileNames: '[name].cjs',
          exports: 'auto'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
