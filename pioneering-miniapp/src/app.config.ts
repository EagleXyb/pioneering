export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
    'pages/sessions/index',
    'pages/chat/index',
    'pages/home/index',
  ],
  window: {
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '创路 Agent',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f3f4f6',
    backgroundTextStyle: 'dark',
  },
  usingComponents: {
    't-button': 'npm/tdesign-miniprogram/button/button',
    't-icon': 'npm/tdesign-miniprogram/icon/icon',
    't-tag': 'npm/tdesign-miniprogram/tag/tag',
    't-loading': 'npm/tdesign-miniprogram/loading/loading',
    't-empty': 'npm/tdesign-miniprogram/empty/empty',
    't-steps': 'npm/tdesign-miniprogram/steps/steps',
    't-step': 'npm/tdesign-miniprogram/step-item/step-item',
    't-navbar': 'npm/tdesign-miniprogram/navbar/navbar',
    't-drawer': 'npm/tdesign-miniprogram/drawer/drawer',
    't-swipe-cell': 'npm/tdesign-miniprogram/swipe-cell/swipe-cell',
  },
});
