import { defineConfig } from '@tarojs/cli';
import devConfig from './dev';
import prodConfig from './prod';
import path from 'path';

export default defineConfig(async (merge) => {
  const baseConfig = {
    projectName: 'pioneering-miniapp',
    date: '2026-5-19',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: ['@tarojs/plugin-framework-react'],
    defineConstants: {},
    copy: {
      patterns: [
        { from: 'src/assets/', to: 'dist/assets/' },
        {
          from: 'node_modules/tdesign-miniprogram-taro/miniprogram_dist/',
          to: 'dist/miniprogram_npm/tdesign-miniprogram/',
          ignore: ['*.ts', '*.map', 'type.js'],
        },
      ],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: { enable: false },
    },
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    sass: {
      resource: [path.resolve(__dirname, '..', 'src/styles/variables.scss')],
    },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      postcss: {
        autoprefixer: { enable: true, config: {} },
        cssModules: {
          enable: true,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
  };

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig);
  }
  return merge({}, baseConfig, prodConfig);
});
