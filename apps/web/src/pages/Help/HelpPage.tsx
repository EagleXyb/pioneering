/**
 * 帮助与反馈页 —— 账户菜单「帮助与反馈」的真实落地页
 * 提供使用指南、快捷键与反馈入口
 */
import { useState } from 'react';
import { MessagePlugin } from 'tdesign-react';
import './help.css';

const FAQ = [
  {
    q: '如何开始一次对话？',
    a: '在左侧点击「新建会话」，选择对话 / 分析 / 任务模式后，在输入框描述你的需求即可。',
  },
  {
    q: '三种模式有什么区别？',
    a: '对话模式用于日常问答；分析模式适合对文档/数据进行深度分析；任务模式可拆解并执行多步任务。',
  },
  {
    q: '会话记录会保存吗？',
    a: '会。所有会话保存在「活跃会话」中；可在侧边栏顶部切换到「归档会话」查看历史。',
  },
  {
    q: '如何切换浅色 / 深色主题？',
    a: '点击左下角头像，在「外观」处切换；或在「设置 → 外观」中调整。',
  },
];

const SHORTCUTS = [
  { key: 'Enter', desc: '发送消息' },
  { key: 'Shift + Enter', desc: '换行' },
  { key: 'Esc', desc: '取消重命名 / 关闭弹层' },
];

export default function HelpPage() {
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitFeedback = async () => {
    const text = feedback.trim();
    if (!text) {
      MessagePlugin.warning('请先填写反馈内容');
      return;
    }
    setSubmitting(true);
    // TODO: 接入后端反馈接口（如 POST /api/feedback）后替换此处
    try {
      await new Promise((r) => setTimeout(r, 400));
      MessagePlugin.success('感谢你的反馈，我们会尽快处理！');
      setFeedback('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="help-page">
      <div className="help-header">
        <h1 className="help-title">帮助与反馈</h1>
        <p className="help-subtitle">快速上手，并告诉我们你的想法</p>
      </div>

      <section className="help-card">
        <h2 className="help-card-title">常见问题</h2>
        <div className="help-faq">
          {FAQ.map((item) => (
            <div className="help-faq-item" key={item.q}>
              <div className="help-faq-q">{item.q}</div>
              <div className="help-faq-a">{item.a}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="help-card">
        <h2 className="help-card-title">快捷键</h2>
        <div className="help-shortcuts">
          {SHORTCUTS.map((s) => (
            <div className="help-shortcut" key={s.key}>
              <kbd className="help-kbd">{s.key}</kbd>
              <span className="help-shortcut-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="help-card">
        <h2 className="help-card-title">提交反馈</h2>
        <p className="help-feedback-hint">遇到问题或有建议？写下来告诉我们：</p>
        <textarea
          className="help-textarea"
          placeholder="描述你遇到的问题或改进建议…"
          value={feedback}
          rows={4}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button
          className="help-submit"
          onClick={handleSubmitFeedback}
          disabled={submitting}
        >
          {submitting ? '提交中…' : '提交反馈'}
        </button>
      </section>
    </div>
  );
}
