/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // monorepo 中 marketing 工作区（Next 14）必须使用 React 18，根 node_modules
    // 提升的是 react@18；web 已升级 React 19（嵌套于 apps/web/node_modules）。
    // dev/build 打包时以工作区为根解析，dedupe 保证 react 单副本；Vitest 下的
    // 原生模块解析（根目录的 zustand/@testing-library 等依赖）由
    // src/test/forceReactSingleton.ts 统一重定向到 19 副本。
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8088',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/docs': {
        target: 'http://localhost:8088',
        changeOrigin: true,
      },
      // 上传产物静态资源（后端 @fastify/static 挂在 /uploads，路径原样转发）
      '/uploads': {
        target: 'http://localhost:8088',
        changeOrigin: true,
      },
    },
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, '../../node_modules'),
      ],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [
      './src/test/forceReactSingleton.ts',
      './src/test/setup.ts',
    ],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
