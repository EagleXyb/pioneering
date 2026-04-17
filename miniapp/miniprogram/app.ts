App({
  globalData: {
    apiBaseUrl: 'https://your-api-domain.com',
    userInfo: null,
    isLoggedIn: false,
  },

  onLaunch() {
    this.checkLoginStatus();
  },

  checkLoginStatus() {
    const token = wx.getStorageSync('token');
    if (token) {
      this.globalData.isLoggedIn = true;
      this.getUserInfo();
    }
  },

  getUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = JSON.parse(userInfo);
    }
  },
});
