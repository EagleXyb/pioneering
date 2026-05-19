export default defineAppConfig({
  lazyCodeLoading: 'requiredComponents',
  pages: [
    'pages/home/index',
    'pages/chat/index',
    'pages/discover/index',
    'pages/profile/index',
  ],
  window: {
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '创路 Agent',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f3f4f6',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    color: '#6b7280',
    selectedColor: '#4f46e5',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'assets/tabbar/home.png',
        selectedIconPath: 'assets/tabbar/home-active.png',
      },
      {
        pagePath: 'pages/chat/index',
        text: '对话',
        iconPath: 'assets/tabbar/chat.png',
        selectedIconPath: 'assets/tabbar/chat-active.png',
      },
      {
        pagePath: 'pages/discover/index',
        text: '发现',
        iconPath: 'assets/tabbar/discover.png',
        selectedIconPath: 'assets/tabbar/discover-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tabbar/profile.png',
        selectedIconPath: 'assets/tabbar/profile-active.png',
      },
    ],
  },
});
