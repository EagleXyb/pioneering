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
    't-button': 'tdesign-miniprogram/button/button',
    't-icon': 'tdesign-miniprogram/icon/icon',
    't-tag': 'tdesign-miniprogram/tag/tag',
    't-loading': 'tdesign-miniprogram/loading/loading',
    't-empty': 'tdesign-miniprogram/empty/empty',
    't-steps': 'tdesign-miniprogram/steps/steps',
    't-step': 'tdesign-miniprogram/step-item/step-item',
    't-navbar': 'tdesign-miniprogram/navbar/navbar',
    't-drawer': 'tdesign-miniprogram/drawer/drawer',
    't-swipe-cell': 'tdesign-miniprogram/swipe-cell/swipe-cell',
  },
});
