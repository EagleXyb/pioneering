import type { UserConfigExport } from '@tarojs/cli';

export default {
  logger: {
    quiet: false,
    stats: true,
  },
  mini: {},
  h5: {},
  defineConstants: {
    __API_BASE_URL__: JSON.stringify('http://localhost:3000'),
  },
} satisfies UserConfigExport;
