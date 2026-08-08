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
    server: {
      port: 5174,
    },
    // 修复 mermaid 依赖 cytoscape 的 UMD 子路径在 vite 预打包时解析失败的问题
    optimizeDeps: {
      exclude: ['mermaid', 'cytoscape']
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // mermaid 以 `cytoscape/dist/cytoscape.umd.js` 深导入 cytoscape，
        // 但 cytoscape 3.30+ 的 exports map 不再暴露 UMD 子路径（vite/rollup 解析报
        // "No known conditions for ./dist/cytoscape.umd.js"）。将 UMD 深导入重定向到
        // ESM 构建产物，绕过 exports 限制（mermaid 官方同类问题的通用解法）。
        'cytoscape/dist/cytoscape.umd.js': 'cytoscape/dist/cytoscape.esm.mjs'
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
