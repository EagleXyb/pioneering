// 构建后拷贝组件 CSS（tsc 只编译 ts/tsx，不处理 .css 资源）
import { cp, stat } from 'node:fs/promises'

await cp('src', 'dist', {
  recursive: true,
  filter: async (src) => src.endsWith('.css') || (await stat(src)).isDirectory(),
})
