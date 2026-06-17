import { useChat } from '@tdesign-react/chat';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { TaskMessageList } from './components/TaskMessageList';
import { TaskInput } from './components/TaskInput';
import { TaskPipeline } from './components/TaskPipeline';
import { getToken } from '../../api/client';
import './task.css';

export default function TaskMode() {
  const activeId = useConversationStore((s) => s.activeId);
  const create = useConversationStore((s) => s.create);

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
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({
          sessionId: activeId,
          message: params.prompt,
          model: 'gpt-4o-mini',
          stream: true,
        }),
      }),
    },
    defaultMessages: [],
  });

  useChatSync(activeId, messages);

  if (!activeId) {
    return (
      <div className="task-empty">
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
    <div className="task-mode">
      <div className="task-main">
        <TaskMessageList messages={messages} status={status} />
        <TaskInput
          status={status}
          onSend={(text) => chatEngine.sendUserMessage({ prompt: text })}
          onStop={() => chatEngine.abortChat()}
        />
      </div>
      <TaskPipeline />
    </div>
  );
}
