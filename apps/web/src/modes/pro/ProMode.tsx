import { useChat, useAgentState } from '@tdesign-react/chat';
import { useConversationStore } from '../../store/conversationStore';
import { useChatSync } from './hooks/useChatSync';
import { AnalysisLayout, ProMainHeader } from './components/AnalysisLayout';
import { AnalysisMessageList } from './components/AnalysisMessageList';
import { AnalysisInput } from './components/AnalysisInput';
import { ProcessPanel } from './components/ProcessPanel';
import { getToken } from '../../api/client';
import './pro.css';

export default function ProMode() {
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

  const { stateMap, currentStateKey } = useAgentState({});

  useChatSync(activeId, messages);

  if (!activeId) {
    return (
      <div className="pro-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
          <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z"/>
        </svg>
        <h2>智能分析</h2>
        <p>输入分析需求，Agent 将自动拆解步骤并执行，实时展示推理过程</p>
        <button onClick={() => create('pro')}>开始分析</button>
      </div>
    );
  }

  return (
    <AnalysisLayout>
      <AnalysisLayout.Main>
        <ProMainHeader status={status} stateMap={stateMap} />
        <AnalysisMessageList messages={messages} status={status} />
        <AnalysisInput
          status={status}
          onSend={(text) => chatEngine.sendUserMessage({ prompt: text })}
          onStop={() => chatEngine.abortChat()}
        />
      </AnalysisLayout.Main>
      <AnalysisLayout.Panel>
        <ProcessPanel stateMap={stateMap} currentStateKey={currentStateKey} />
      </AnalysisLayout.Panel>
    </AnalysisLayout>
  );
}