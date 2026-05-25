export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
    'pages/login/login',
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
    't-button': 'tdesign-miniprogram/button/button',
    't-drawer': 'tdesign-miniprogram/drawer/drawer',
    't-icon': 'tdesign-miniprogram/icon/icon',
    't-navbar': 'tdesign-miniprogram/navbar/navbar',
    't-chat-message': 'tdesign-miniprogram/chat-message/chat-message',
    't-chat-content': 'tdesign-miniprogram/chat-content/chat-content',
  },
});
