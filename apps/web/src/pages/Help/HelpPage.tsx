/**
 * 帮助与反馈页 —— 严格参照 apps/web/docs/help-feedback.html 原型一比一还原
 * 布局：900×600 浮动窗口，左侧 230px 导航 + 右侧内容区
 *
 * 阶段 3（3.1）：MessagePlugin → sonner toast；内联手写 SVG 全部替换为
 * lucide-react（图标策略统一），DOM 结构与 help.css 类名保持不变。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Archive,
  ArrowUpRight,
  Bot,
  Boxes,
  CircleHelp,
  FileText,
  Keyboard,
  Lightbulb,
  MessageSquare,
  Phone,
  Settings,
  Shield,
  Sparkles,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import './help.css';

/* ===== 导航分类 ===== */
const NAV_SECTIONS: ReadonlyArray<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'account', label: '账户管理', icon: User },
  { id: 'system', label: '系统设置', icon: Settings },
  { id: 'agent', label: '智能体设置', icon: Bot },
  { id: 'shortcut', label: '快捷键', icon: Keyboard },
  { id: 'memory', label: '记忆', icon: Lightbulb },
  { id: 'model', label: '模型', icon: Boxes },
  { id: 'assistant', label: '助理设置', icon: User },
  { id: 'personalize', label: '个性化', icon: Sparkles },
  { id: 'data', label: '数据管理', icon: Archive },
  { id: 'security', label: '安全中心', icon: Shield },
  { id: 'help', label: '帮助与反馈', icon: CircleHelp },
];

type NavId = (typeof NAV_SECTIONS)[number]['id'];

export default function HelpPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState<NavId>('help');

  const handleClose = () => navigate('/chat');

  const handleSelectNav = (id: NavId) => {
    if (id === 'help') return;
    setActive(id);
    toast.info('该分类暂未开放');
  };

  return (
    <div className="help-page">
      <div className="window">
        {/* 左侧分类导航 */}
        <aside className="sidebar">
          <ul className="nav-list">
            {NAV_SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <li
                  key={s.id}
                  className={`nav-item${active === s.id ? ' nav-item--active' : ''}`}
                  onClick={() => handleSelectNav(s.id)}
                >
                  <Icon className="nav-icon" strokeWidth={2} />
                  {s.label}
                </li>
              );
            })}
          </ul>
        </aside>

        {/* 右侧内容区 */}
        <main className="main">
          {/* 关闭按钮 */}
          <div className="close-btn" onClick={handleClose} aria-label="关闭">
            <X strokeWidth={2} />
          </div>

          <h1 className="page-title">帮助与反馈</h1>

          <ul className="help-list">
            {/* 帮助文档 */}
            <li
              className="help-item"
              onClick={() => window.open('https://example.com/docs', '_blank')}
            >
              <span className="help-item__left">
                <FileText className="help-item__icon" strokeWidth={2} />
                帮助文档
              </span>
              <ArrowUpRight className="help-item__arrow" strokeWidth={2} />
            </li>

            {/* 意见反馈 */}
            <li
              className="help-item"
              onClick={() => toast.info('意见反馈功能正在建设中')}
            >
              <span className="help-item__left">
                <MessageSquare className="help-item__icon" strokeWidth={2} />
                意见反馈
              </span>
            </li>

            {/* 联系我们 */}
            <li
              className="help-item"
              onClick={() => window.open('mailto:support@example.com', '_blank')}
            >
              <span className="help-item__left">
                <Phone className="help-item__icon" strokeWidth={2} />
                联系我们
              </span>
              <ArrowUpRight className="help-item__arrow" strokeWidth={2} />
            </li>
          </ul>

          <div className="help-footer">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                toast.info('隐私政策');
              }}
            >
              隐私政策
            </a>
            <span className="help-footer__divider">|</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                toast.info('服务协议');
              }}
            >
              服务协议
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
