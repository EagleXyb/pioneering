Page({
  data: {
    email: '',
    name: '',
  },

  onEmailInput(e: any) {
    this.setData({ email: e.detail.value });
  },

  onNameInput(e: any) {
    this.setData({ name: e.detail.value });
  },

  onWxLogin() {
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        const { nickName, avatarUrl } = res.userInfo;
        const app = getApp();
        app.globalData.isLoggedIn = true;
        app.globalData.userInfo = { name: nickName, avatar: avatarUrl };
        wx.setStorageSync('userInfo', JSON.stringify({ name: nickName, avatar: avatarUrl }));
        wx.switchTab({ url: '/pages/home/index' });
      },
      fail: () => {
        wx.showToast({ title: '登录取消', icon: 'none' });
      },
    });
  },
});
