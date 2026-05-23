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
    't-icon': 'npm/tdesign-miniprogram/icon/icon',
    't-navbar': 'npm/tdesign-miniprogram/navbar/navbar',
    't-chat-message': 'npm/tdesign-miniprogram/chat-message/chat-message',
    't-chat-content': 'npm/tdesign-miniprogram/chat-content/chat-content',
  },
});
