import { useChat } from '@tdesign-react/chat';
import { useConversationStore } from '../../store/conversationStore';
import { useArtifactStore } from '../../store/artifactStore';
import { useAppStore } from '../../store/appStore';
import { useChatSync } from './hooks/useChatSync';
import { TaskMessageList } from './components/TaskMessageList';
import { TaskInput } from './components/TaskInput';
import { TaskPipeline } from './components/TaskPipeline';
import { TaskResizer } from './components/TaskResizer';
import { ArtifactPanel } from '@/components/ArtifactPreview/ArtifactPanel';
import '@/components/ArtifactPreview/artifactPanel.css';
import { TaskTopBar } from '../../layout/TaskTopBar/TaskTopBar';
import { getAuthHeader } from '../../api/client';
import { getDefaultModel } from '../../config/models';
import { useEffect } from 'react';
import './task.css';

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

  const { chatEngine, messages, status } = useChat({
    chatServiceConfig: {
      endpoint: '/api/chat/completions',
      stream: true,
      protocol: 'agui',
      onRequest: (params) => ({
        ...params,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          sessionId: activeId,
          message: params.prompt,
          model: getDefaultModel('task'),
          stream: true,
        }),
      }),
    },
    defaultMessages: [],
  });

  useChatSync(activeId, messages);

  // 切换会话时清理 artifact 状态，避免上一个会话的预览残留
  useEffect(() => {
    resetArtifact();
  }, [activeId, resetArtifact]);

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
        {activeId ? (
          <>
            <TaskMessageList messages={messages} status={status} />
            <TaskInput
              chatId={activeId}
              status={status}
              onSend={(text) => chatEngine.sendUserMessage({ prompt: text })}
              onStop={() => chatEngine.abortChat()}
            />
          </>
        ) : (
          <div className="task-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
              <rect x="1" y="1" width="22" height="22" rx="2"/>
              <path d="M7 8h10M7 12h6M7 16h8"/>
            </svg>
            <h2>任务模式</h2>
            <p>创建任务，Agent 将自动规划并执行多步骤操作，支持复杂的 Plan-and-Execute 流程</p>
            <button onClick={() => create('task')}>创建任务</button>
          </div>
        )}
      </div>
      {/* 右侧面板：有 artifact 预览时显示 ArtifactPanel，否则显示原 TaskPipeline */}
      {/* resizer 仅在右侧面板实际可见（非折叠 / 有 artifact）时显示 */}
      {showResizer && <TaskResizer />}
      {hasActiveArtifact ? <ArtifactPanel /> : <TaskPipeline />}
    </div>
  );
}
