export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
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
});
