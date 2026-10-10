import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ChatMessagesData, ChatStatus } from '../types/chat';
import { isLocalMessageId, resolveLocalMessageIds } from '../lib/resolve-message-ids';

/**
 * 用户消息「行内编辑 → 重新发送」的会话级编排（chat / pro / task 三模式共用）
 *
 * 职责收敛为一个 Hook，保证三个模式在下列方面完全一致：
 *   - 同一时刻只有一条消息处于编辑态，会话切换即清空
 *   - 流式/待响应中禁止编辑（避免与进行中的生成互相干扰）
 *   - 临时会话（`temp_*`，后端尚未创建）禁止编辑
 *   - 本地乐观 id（`u_*`/`a_*`）先与后端历史对齐出真实 id，否则给出明确提示
 *   - 提交中的按钮禁用状态（submitting）
 *
 * 具体的"如何重发"由调用方通过 onResend 注入（三个模式走的接口不同）。
 */
export interface UseUserMessageEditOptions {
  /** 当前会话 id（null / temp_* 时不可编辑） */
  activeId: string | null;
  /** 当前消息列表（用于本地 id → 真实 id 的对齐） */
  messages: ChatMessagesData[];
  /** 会话级状态（streaming / pending 时禁止编辑） */
  status: ChatStatus;
  /** 拿到真实 messageId 后的重发动作（由各模式注入） */
  onResend: (messageId: string, nextText: string) => void;
}

export interface UseUserMessageEditReturn {
  editingId: string | null;
  submitting: boolean;
  /** 是否允许展示编辑入口 */
  canEdit: boolean;
  startEdit: (messageId: string) => void;
  cancelEdit: () => void;
  /** 提交编辑（父层直接透传给 UserMessageBubble.onSubmitEdit） */
  submitEdit: (messageId: string, nextText: string) => Promise<void>;
}

export function useUserMessageEdit({
  activeId,
  messages,
  status,
  onResend,
}: UseUserMessageEditOptions): UseUserMessageEditReturn {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 会话切换：清空编辑态与提交中标志，避免残留在新会话
  useEffect(() => {
    setEditingId(null);
    setSubmitting(false);
  }, [activeId]);

  const busy = status === 'streaming' || status === 'pending';
  const canEdit = !!activeId && !activeId.startsWith('temp_') && !busy;

  const startEdit = useCallback((messageId: string) => {
    setEditingId(messageId);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const submitEdit = useCallback(
    async (messageId: string, nextText: string) => {
      if (!activeId) return;
      if (activeId.startsWith('temp_')) {
        toast.error('会话尚未就绪，请稍后重试');
        return;
      }
      if (busy) {
        toast.info('正在生成回复，请稍后再试');
        return;
      }

      setSubmitting(true);
      try {
        let realId = messageId;
        if (isLocalMessageId(messageId)) {
          const ids = await resolveLocalMessageIds(activeId, messages);
          realId = ids.get(messageId) ?? '';
          if (!realId) {
            // 宁可失败也不猜 id：错配会改错后端数据
            toast.error('无法定位该消息，请刷新会话后重试');
            return;
          }
        }
        setEditingId(null);
        onResend(realId, nextText);
      } finally {
        setSubmitting(false);
      }
    },
    [activeId, busy, messages, onResend],
  );

  return { editingId, submitting, canEdit, startEdit, cancelEdit, submitEdit };
}
