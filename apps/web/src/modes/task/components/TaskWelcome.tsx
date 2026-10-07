import { ModeWelcome } from '@/components/welcome/ModeWelcome';

interface Props {
  /** 点击建议词时回调（由 TaskMode 触发发送） */
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  '帮我策划一次新产品发布会并产出物料清单',
  '调研三个竞品官网，输出对比分析报告',
  '把这份需求拆解成可执行的开发任务',
  '规划本季度的内容营销日历',
];

/**
 * 任务模式空会话欢迎页 —— 与 chat 欢迎页同一套布局。
 * 文案聚焦 Plan-and-Execute：描述目标即可自动规划、分步执行。
 */
export function TaskWelcome({ onSuggestion }: Props) {
  return (
    <ModeWelcome
      badge="PLAN-AND-EXECUTE 智能任务"
      title="今天有什么任务要执行？"
      subtitle="描述目标，创路 Agent 会自动拆解步骤、规划并逐项执行，右侧实时展示任务流水线。"
      suggestions={SUGGESTIONS}
      onSuggestion={onSuggestion}
    />
  );
}
