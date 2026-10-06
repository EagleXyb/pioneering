/**
 * 测试环境 React 单例强制（React 19 升级配套）
 *
 * 背景：本仓库是 npm workspaces monorepo，marketing 工作区（Next 14）必须使用
 * React 18，因此根 node_modules 提升的是 react/react-dom@18；web 工作区已升级
 * React 19（嵌套于 apps/web/node_modules）。
 *
 * Vitest 执行测试时，位于根 node_modules 的 @testing-library/react（CJS）与
 * zustand（ESM .mjs）等依赖会沿各自物理路径解析 react：CJS 侧拿到根 18 会产生
 * "Objects are not valid as a React child"，ESM 侧拿到根 18 会产生
 * "Invalid hook call / Cannot read properties of null (reading 'useCallback')"。
 *
 * 两道拦截把进程内全部 react/react-dom/scheduler 统一到 web 的 19 副本：
 * 1. module.register 注册 resolve hook（reactSingletonHooks.mjs）：拦截 ESM 与
 *    现代 CJS 解析（zustand 等 .mjs 依赖只能靠它）；
 * 2. Module._resolveFilename patch：兜底传统 CJS require。
 * 仅影响 Vitest；dev server 与生产构建走 Vite 打包，由 resolve.dedupe 保证单副本。
 */
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import Module from 'node:module';

// ---- 1. ESM resolve hook（对现代 Node 的 CJS 请求同样生效）----
// 注意：不能用 import.meta.url 作为锚点——vite-node 中它是 http:// URL，
// register 的 hook 线程只接受 file:/data: 协议，这里改用进程 cwd（apps/web）。
register(
  pathToFileURL(
    path.join(process.cwd(), 'src/test/reactSingletonHooks.mjs'),
  ).href,
);

// ---- 2. 传统 CJS require 兜底 ----
const localRequire = createRequire(import.meta.url);

const SINGLETON_SPECS = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react/compiler-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/test-utils',
  'scheduler',
  'scheduler/tracing',
]);

const originalResolveFilename = (
  Module as typeof Module & {
    _resolveFilename: (
      request: string,
      parent: NodeModule | null | undefined,
      ...rest: unknown[]
    ) => string;
  }
)._resolveFilename;

(
  Module as typeof Module & {
    _resolveFilename: typeof originalResolveFilename;
  }
)._resolveFilename = function patchedResolveFilename(request, parent, ...rest) {
  if (SINGLETON_SPECS.has(request)) {
    try {
      return localRequire.resolve(request);
    } catch {
      // 个别子路径不存在时回退默认解析
    }
  }
  return originalResolveFilename.call(this, request, parent, ...rest);
};
