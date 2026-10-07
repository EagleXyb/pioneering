import { ModeWelcome } from '@/components/welcome/ModeWelcome';

interface Props {
  /** 点击建议词时回调（由 ChatMode 触发发送） */
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  '帮我分析上季度销售流失的原因',
  '写一份新产品发布会的演讲稿',
  '把这段会议纪要整理成待办清单',
  '本季度各渠道投入产出比如何',
];

/**
 * Chat 模式初始欢迎页 —— 登录后空会话首屏。
 * 通用布局与三种模式触达卡片由共享 ModeWelcome 承载，
 * 此处仅提供 chat 模式的文案与建议词。
 */
export function ChatWelcome({ onSuggestion }: Props) {
  return (
    <ModeWelcome
      badge="多模态智能工作台"
      title="你好，今天想做点什么？"
      subtitle="对话、分析、任务，一个工作台全搞定。创路 Agent 帮你把创意高效落地，安全可靠。"
      suggestions={SUGGESTIONS}
      onSuggestion={onSuggestion}
    />
  );
}
