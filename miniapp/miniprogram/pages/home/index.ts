Page({
  data: {
    userInfo: null,
    isLoggedIn: false,
    features: [
      { id: 'assessment', title: '创新评估', desc: 'AI驱动的创新能力测评', icon: '📊' },
      { id: 'training', title: '创新训练', desc: '系统化的创新能力提升', icon: '🎯' },
      { id: 'incubation', title: '创意孵化', desc: '从创意到落地的全流程', icon: '🚀' },
      { id: 'experience', title: '创新体验', desc: '沉浸式创新工具集', icon: '✨' },
    ],
  },

  onLoad() {
    this.checkLogin();
  },

  onShow() {
    this.checkLogin();
  },

  checkLogin() {
    const app = getApp();
    this.setData({
      isLoggedIn: app.globalData.isLoggedIn,
      userInfo: app.globalData.userInfo,
    });
  },

  onFeatureTap(e: any) {
    const id = e.currentTarget.dataset.id;
    const routeMap: Record<string, string> = {
      assessment: '/pages/assessment/index',
      training: '/pages/training/index',
      incubation: '/pages/incubation/index',
      experience: '/pages/experience/index',
    };
    const url = routeMap[id];
    if (url) {
      wx.navigateTo({ url });
    }
  },

  onProfileTap() {
    wx.switchTab({ url: '/pages/profile/index' });
  },
});
