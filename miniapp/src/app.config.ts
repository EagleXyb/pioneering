export default defineAppConfig({
  pages: [
    'pages/iac/index',
    'pages/case-library/index',
    'pages/training/index',
    'pages/profile/index',
    'pages/login/index',
    'pages/training/assessment/index',
    'pages/training/basic-assessment/index',
    'pages/training/incubation/index',
    'pages/training/experience/index',
  ],
  window: {
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: 'IAC 创新孵化',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f5f5f7',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    color: '#333333',
    selectedColor: '#2490f8',
    backgroundColor: '#F6F6F6',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/iac/index',
        text: 'IAC',
        iconPath: 'assets/iac.png',
        selectedIconPath: 'assets/iac- selected.png',
      },
      {
        pagePath: 'pages/case-library/index',
        text: '案例库',
        iconPath: 'assets/tabbar/Case-Library.png',
        selectedIconPath: 'assets/tabbar/Case-Library-fill.png',
      },
      {
        pagePath: 'pages/training/index',
        text: '训练',
        iconPath: 'assets/tabbar/Training.png',
        selectedIconPath: 'assets/tabbar/Training-fill.png',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/tabbar/Mine.png',
        selectedIconPath: 'assets/tabbar/Mine-fill.png',
      },
    ],
  },
});