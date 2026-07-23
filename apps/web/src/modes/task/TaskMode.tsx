import { useConversationStore } from '../../store/conversationStore';
import { useArtifactStore } from '../../store/artifactStore';
import { useAppStore } from '../../store/appStore';
import { useChatSync } from './hooks/useChatSync';
import { usePlanExecuteChat } from './hooks/usePlanExecuteChat';
import { TaskMessageList } from './components/TaskMessageList';
import { TaskInput } from './components/TaskInput';
import { TaskPipeline } from './components/TaskPipeline';
import { TaskResizer } from './components/TaskResizer';
import { ArtifactPanel } from '@/components/ArtifactPreview/ArtifactPanel';
import '@/components/ArtifactPreview/artifactPanel.css';
import { TaskTopBar } from '../../layout/TaskTopBar/TaskTopBar';
import { useEffect } from 'react';
import './task.css';

/**
 * 任务模式主组件（P4 Plan-and-Execute 对接版）
 *
 * 改造说明：
 *   - 从 @tdesign-react/chat 的 useChat 切换到自定义 usePlanExecuteChat，
 *     以支持 STATE_DELTA 事件解析和 planExecuteStore 驱动
 *   - 请求体新增 agentMode: 'plan_execute' 启用后端 Plan-Execute 图
 *   - 切换会话时调用 reset() 清空消息和 plan 状态（原实现仅 resetArtifact）
 *   - ArtifactPanel 与 TaskPipeline 互斥逻辑保持不变
 */
export default function TaskMode() {
  const activeId = useConversationStore((s) => s.activeId);
  const create = useConversationStore((s) => s.create);
  // 订阅 activeArtifact：当用户预览 artifact 时显示 ArtifactPanel，
  // 否则显示原有的 TaskPipeline。二者互斥，避免布局挤压。
  const hasActiveArtifact = useArtifactStore((s) => s.activeArtifact !== null);
  const resetArtifact = useArtifactStore((s) => s.reset);
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);
  // 右侧面板实际可见（artifact 预览中，或任务流水线展开）时才显示分隔条
  const showResizer = hasActiveArtifact || pipelineOpen;

  // P4: 替换 useChat 为 usePlanExecuteChat，支持 STATE_DELTA 事件
  const { messages, status, sendMessage, abort, reset, loadHistory } = usePlanExecuteChat(activeId);

  useChatSync(activeId, messages);

  // 切换会话时清理 artifact 状态；并从后端恢复历史消息与 plan 时间轴快照
  // - temp_ 前缀的临时会话：仅 reset（后端尚未创建，无可恢复数据）
  // - 真实会话：调 loadHistory 拉取消息并装配 plan 终态（source='history'）
  useEffect(() => {
    resetArtifact();
    if (activeId && !activeId.startsWith('temp_')) {
      void loadHistory(activeId);
    } else {
      reset();
    }
  }, [activeId, resetArtifact, reset, loadHistory]);

  if (!activeId) {
    return (
      <div className="task-empty task-empty--root">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
          <rect x="1" y="1" width="22" height="22" rx="2"/>
          <path d="M7 8h10M7 12h6M7 16h8"/>
        </svg>
        <h2>任务模式</h2>
        <p>创建任务，Agent 将自动规划并执行多步骤操作，支持复杂的 Plan-and-Execute 流程</p>
        <button onClick={() => create('task')}>创建任务</button>
      </div>
    );
  }

  return (
    <div className="task-mode tw-scope">
      <div className="task-main">
        <TaskTopBar />
        <TaskMessageList messages={messages} status={status} />
        <TaskInput
          chatId={activeId}
          status={status}
          onSend={(text) => sendMessage({ prompt: text })}
          onStop={abort}
        />
      </div>
      {/* 右侧面板：有 artifact 预览时显示 ArtifactPanel，否则显示 TaskPipeline（含 PlanPipelineTree） */}
      {/* resizer 仅在右侧面板实际可见（非折叠 / 有 artifact）时显示 */}
      {showResizer && <TaskResizer />}
      {hasActiveArtifact ? <ArtifactPanel /> : <TaskPipeline />}
    </div>
  );
}
