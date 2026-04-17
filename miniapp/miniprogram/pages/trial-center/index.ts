Page({
  data: {
    selectedProject: 'normal',
    inputValue: '',
    messages: [],
    projectOptions: [
      { id: 'normal', name: '普通模式', description: '适配多元场景支持多轮对话' },
      { id: 'professional', name: '专业模式', description: '聚焦专业领域精准交付成果' },
      { id: 'task', name: '任务模式', description: '承接复杂任务高效推进落地' },
    ],
  },

  onLoad() {},

  onProjectChange(e: any) {
    this.setData({ selectedProject: e.currentTarget.dataset.id });
  },

  onInput(e: any) {
    this.setData({ inputValue: e.detail.value });
  },

  onSend() {
    const { inputValue } = this.data;
    if (!inputValue.trim()) return;
    this.setData({ inputValue: '' });
  },
});
