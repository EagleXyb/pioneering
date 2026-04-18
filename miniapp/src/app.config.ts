export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/trial-center/index',
    'pages/training/index',
    'pages/profile/index',
    'pages/login/index',
    'pages/assessment/index',
    'pages/basic-assessment/index',
    'pages/incubation/index',
    'pages/experience/index',
  ],
  window: {
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'IAC 创新孵化',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f5f7',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    color: '#86868b',
    selectedColor: '#2490f8',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'assets/tab-home.png',
        selectedIconPath: 'assets/tab-home-active.png',
      },
      {
        pagePath: 'pages/training/index',
        text: '训练',
        iconPath: 'assets/tab-training.png',
        selectedIconPath: 'assets/tab-training-active.png',
      },
      {
        pagePath: 'pages/trial-center/index',
        text: '体验',
        iconPath: 'assets/tab-trial.png',
        selectedIconPath: 'assets/tab-trial-active.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tab-profile.png',
        selectedIconPath: 'assets/tab-profile-active.png',
      },
    ],
  },
});
