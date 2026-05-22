export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
    'pages/chat/chat',
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
    't-drawer': 'npm/tdesign-miniprogram/drawer/drawer',
    't-skeleton': 'npm/tdesign-miniprogram/skeleton/skeleton',
    't-toast': 'npm/tdesign-miniprogram/toast/toast',
    't-popup': 'npm/tdesign-miniprogram/popup/popup',
    't-icon': 'npm/tdesign-miniprogram/icon/icon',
    't-overlay': 'npm/tdesign-miniprogram/overlay/overlay',
    't-image': 'npm/tdesign-miniprogram/image/image',
    't-loading': 'npm/tdesign-miniprogram/loading/loading',
    't-navbar': 'npm/tdesign-miniprogram/navbar/navbar',
    'attachments': 'npm/tdesign-miniprogram/attachments/attachments',
    't-chat-message': 'npm/tdesign-miniprogram/chat-message/chat-message',
    't-chat-content': 'npm/tdesign-miniprogram/chat-content/chat-content',
  },
});
