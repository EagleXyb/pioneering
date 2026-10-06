/**
 * Vitest 工作线程内注册的 ESM resolve hook
 *
 * 作用：把进程内对 react / react-dom / scheduler 三个包（含全部子路径）的
 * 解析，统一重定向到 apps/web/node_modules 下的 React 19 物理副本。
 *
 * 背景见同目录 forceReactSingleton.ts 的说明：monorepo 根提升的是 marketing
 * 需要的 React 18；zustand 等以 ESM(.mjs) 形态加载的根目录依赖，其
 * `import 'react'` 走 Node ESM 解析器，CJS 的 Module._resolveFilename
 * patch 拦截不到，必须用本 resolve hook 统一。
 *
 * Node 24 中已注册的 resolve hook 对 ESM 与 CJS 请求均生效。
 */
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// 本文件位于 apps/web/src/test/，createRequire 锚定其目录，
// 向上解析必然命中 apps/web/node_modules（React 19）
const localRequire = createRequire(import.meta.url);

const PACKAGES = ['react', 'react-dom', 'scheduler'];

function isTarget(specifier) {
  return PACKAGES.some(
    (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
  );
}

export async function resolve(specifier, context, nextResolve) {
  if (isTarget(specifier)) {
    try {
      // 以 CJS 解析拿到具体入口文件；react 全系为 CJS，ESM 可直接导入
      const filename = localRequire.resolve(specifier);
      return {
        url: pathToFileURL(filename).href,
        shortCircuit: true,
      };
    } catch {
      // 解析失败时回退默认链
    }
  }
  return nextResolve(specifier, context);
}
