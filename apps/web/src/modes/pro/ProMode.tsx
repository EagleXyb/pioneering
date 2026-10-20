import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
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
import { EmptyStateGlyph } from '@/components/icons/emptyStateGlyph';
import { useHitlStore } from '@pioneering/agent-protocol';
import { useSessionRuns } from '../../hooks/useSessionRuns';
import { getSelectedModelId } from '@/hooks/useModelOptions';
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
  const { runs, byMessage: runByMessage } = useSessionRuns(activeId, status);

  useChatSync(activeId, messages);

  // 用户消息行内编辑（编辑重发走 agent 通道，方案 B）
  const handleResend = useCallback(
    (messageId: string, nextText: string) =>
      resendEditedMessage({
        messageId,
        prompt: nextText,
        model: getSelectedModelId('pro'),
      }),
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

  /**
   * 重新生成：定位触发该助手消息的用户消息，走"编辑重发"通道
   * （messageId + truncateAfter 截断该消息之后的会话与产物并重跑 agent）。
   * 运行中/无对应用户消息时拒绝执行。
   */
  const handleRegenerate = useCallback(
    (assistantMessageId: string) => {
      if (status === 'streaming' || status === 'pending') return;
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx < 0) return;
      for (let i = idx - 1; i >= 0; i -= 1) {
        const m = messages[i]!;
        if (m.role !== 'user') continue;
        const prompt = m.content
          .filter((c): c is { type: 'text'; data: string } => c.type === 'text')
          .map((c) => c.data)
          .join('\n')
          .trim();
        if (!prompt) break;
        resendEditedMessage({
          messageId: m.id,
          prompt,
          model: getSelectedModelId('pro'),
        });
        return;
      }
      toast.info('未找到触发本轮回复的用户消息，无法重新生成');
    },
    [messages, status, resendEditedMessage],
  );

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
        <EmptyStateGlyph variant="pro" className="pro-empty-glyph" />
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
          onRegenerate={handleRegenerate}
        />
        <AnalysisInput
          chatId={activeId}
          status={status}
          hitl={hitl}
          hitlError={hitlError}
          hitlBusy={hitlBusy}
          onSend={(text) =>
            sendMessage({ prompt: text, model: getSelectedModelId('pro') })
          }
          onStop={() => abort()}
        />
      </AnalysisLayout.Main>
      {/* 右侧面板（推理过程）展开时显示可拖拽分隔条，折叠时隐藏 */}
      {pipelineOpen && <TaskResizer />}
      <AnalysisLayout.Panel>
        <ProcessPanel
          stateMap={stateMap}
          currentStateKey={currentStateKey}
          runs={runs}
        />
      </AnalysisLayout.Panel>
    </AnalysisLayout>
  );
}