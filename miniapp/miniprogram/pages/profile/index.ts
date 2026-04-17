const { fetchProfileByEmail, uploadAvatar } = require('../../services/index');

Page({
  data: {
    userInfo: null,
    isEditing: false,
  },

  onLoad() {
    this.loadProfile();
  },

  async loadProfile() {
    const app = getApp();
    if (app.globalData.userInfo) {
      this.setData({ userInfo: app.globalData.userInfo });
    }
  },

  onEdit() {
    this.setData({ isEditing: true });
  },

  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: async (res: any) => {
        const filePath = res.tempFiles[0].tempFilePath;
        const email = this.data.userInfo?.email;
        if (email) {
          try {
            const result = await uploadAvatar(email, filePath);
            this.setData({ 'userInfo.avatar': result.avatar });
          } catch (err) {
            wx.showToast({ title: '上传失败', icon: 'none' });
          }
        }
      },
    });
  },
});
