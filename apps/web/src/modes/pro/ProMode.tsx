import { useConversationStore } from '../../store/conversationStore';
import { useAppStore } from '../../store/appStore';
import { useAgentChat } from './hooks/useAgentChat';
import { useChatSync } from './hooks/useChatSync';
import { AnalysisLayout } from './components/AnalysisLayout';
import { AnalysisMessageList } from './components/AnalysisMessageList';
import { AnalysisInput } from './components/AnalysisInput';
import { ProcessPanel } from './components/ProcessPanel';
import { TaskResizer } from '../task/components/TaskResizer';
import './pro.css';

export default function ProMode() {
  const activeId = useConversationStore((s) => s.activeId);
  const create = useConversationStore((s) => s.create);
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);

  const { messages, status, stateMap, currentStateKey, sendMessage, abort } =
    useAgentChat(activeId, false);

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
        <AnalysisMessageList messages={messages} status={status} />
        <AnalysisInput
          status={status}
          onSend={(text) => sendMessage({ prompt: text })}
          onStop={() => abort()}
        />
      </AnalysisLayout.Main>
      {/* 右侧面板（推理过程）展开时显示可拖拽分隔条，折叠时隐藏 */}
      {pipelineOpen && <TaskResizer />}
      <AnalysisLayout.Panel>
        <ProcessPanel stateMap={stateMap} currentStateKey={currentStateKey} />
      </AnalysisLayout.Panel>
    </AnalysisLayout>
  );
}