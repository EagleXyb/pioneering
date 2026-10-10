import { useCallback, useEffect } from 'react';
import { useConversationStore } from '../../store/conversationStore';
import { useAppStore } from '../../store/appStore';
import { Button } from '@/components/ui/button';
import { useAgentChat } from './hooks/useAgentChat';
import { useChatSync } from './hooks/useChatSync';
import { useUserMessageEdit } from '@/hooks/useUserMessageEdit';
import { AnalysisLayout } from './components/AnalysisLayout';
import { AnalysisMessageList } from './components/AnalysisMessageList';
import { AnalysisInput } from './components/AnalysisInput';
import { ProcessPanel } from './components/ProcessPanel';
import { TaskResizer } from '../task/components/TaskResizer';
import { useHitlStore } from '@pioneering/agent-protocol';
import { useSessionRuns } from '../../hooks/useSessionRuns';
import './pro.css';

export default function ProMode() {
  const activeId = useConversationStore((s) => s.activeId);
  const create = useConversationStore((s) => s.create);
  const pipelineOpen = useAppStore((s) => s.pipelineOpen);

  const {
    messages,
    status,
    stateMap,
    currentStateKey,
    sendMessage,
    resendEditedMessage,
    abort,
    loadHistory,
    hitl,
    hitlError,
    hitlBusy,
  } = useAgentChat(activeId, false);

  // T5.5：按会话加载 run 记录（messageId → 执行轨迹）
  const { byMessage: runByMessage } = useSessionRuns(activeId, status);

  useChatSync(activeId, messages);

  // 用户消息行内编辑（编辑重发走 agent 通道，方案 B）
  const handleResend = useCallback(
    (messageId: string, nextText: string) =>
      resendEditedMessage({ messageId, prompt: nextText }),
    [resendEditedMessage],
  );
  const {
    editingId,
    submitting: submittingEdit,
    canEdit: canEditUserMessage,
    startEdit,
    cancelEdit,
    submitEdit,
  } = useUserMessageEdit({ activeId, messages, status, onResend: handleResend });

  // T3.1 + T1.6：会话切换时先恢复历史，再检测待答复项（暂停则补占位卡片）
  useEffect(() => {
    if (activeId && !activeId.startsWith('temp_')) {
      void (async () => {
        await loadHistory(activeId);
        await useHitlStore.getState().recover(activeId);
      })();
    }
  }, [activeId, loadHistory]);

  if (!activeId) {
    return (
      <div className="pro-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
          <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z"/>
        </svg>
        <h2>智能分析</h2>
        <p>输入分析需求，Agent 将自动拆解步骤并执行，实时展示推理过程</p>
        <Button onClick={() => create('pro')}>开始分析</Button>
      </div>
    );
  }

  return (
    <AnalysisLayout>
      <AnalysisLayout.Main>
        <AnalysisMessageList
          messages={messages}
          status={status}
          runByMessage={runByMessage}
          canEditUserMessage={canEditUserMessage}
          editingMessageId={editingId}
          submittingEdit={submittingEdit}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onSubmitEdit={submitEdit}
        />
        <AnalysisInput
          chatId={activeId}
          status={status}
          hitl={hitl}
          hitlError={hitlError}
          hitlBusy={hitlBusy}
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