import React, { useRef, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Copy,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AIMessageContent,
  ChatComment,
  ChatMessagesData,
  ChatStatus,
} from '../../../types/chat';
import type { AgentRunData } from '../../../api/agent';
import { RunTrace } from '../../../components/run-trace/RunTrace';
import { Markdown } from '@/components/Markdown';
import { UserMessageBubble } from '@/components/message/UserMessageBubble';
import { ReasoningBlock } from '@/components/message/ReasoningBlock';
import { ToolBatchRow, ToolCallRow } from '@/components/message/ToolCallRow';
import { ProcessContainer } from '@/components/message/ProcessContainer';
import { describeToolAction } from '@/lib/toolAction';
import { ScrollToBottomButton } from '@/components/message/ScrollToBottomButton';
import {
  blocksToPlainText,
  isNarrationBlock,
  reasoningPhase,
  reasoningText,
  type TaoToolBlock,
} from '../../../lib/taoBlocks';
import {
  ShareForwardIcon,
  type ActionIconProps,
} from '@/components/icons/customIcons';
import { EmptyStateGlyph } from '@/components/icons/emptyStateGlyph';
import type { ChatMessageData } from '@/api/converter';
import { feedbackMessage } from '@/api/message';

interface Props {
  messages: ChatMessagesData[];
  status: ChatStatus;
  /** messageId → 该消息对应的 run（执行轨迹） */
  runByMessage?: ReadonlyMap<string, AgentRunData>;
  /** 用户消息是否可编辑（流式中禁用） */
  canEditUserMessage?: boolean;
  /** 当前处于编辑态的消息 id（同一时刻仅一条） */
  editingMessageId?: string | null;
  /** 编辑提交中 */
  submittingEdit?: boolean;
  onStartEdit?: (messageId: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (messageId: string, nextText: string) => void | Promise<void>;
}

/** 用户消息编辑相关的透传属性（AnalysisMessageList → AnalysisMessageItem） */
type EditProps = Pick<
  Props,
  | 'canEditUserMessage'
  | 'editingMessageId'
  | 'submittingEdit'
  | 'onStartEdit'
  | 'onCancelEdit'
  | 'onSubmitEdit'
>;

/**
 * 提取消息中所有正文（text/markdown）拼成纯文本（复制用）。
 * 思考与工具过程不进入复制内容（它们是过程信息，不是回答）。
 */
function extractText(message: ChatMessagesData): string {
  if (message.role === 'system') {
    return message.content.map((c) => c.data).join('\n');
  }
  if (message.role === 'user') {
    // 用户消息为 text/attachment 内容：复制只取文本
    return message.content
      .filter((c): c is { type: 'text'; data: string } => c.type === 'text')
      .map((c) => c.data)
      .join('\n');
  }
  return blocksToPlainText(message.content);
}

/** 单条分析消息：用户右对齐气泡；助手通栏 Markdown + 操作栏 + 执行轨迹 */
function AnalysisMessageItem({
  message,
  runByMessage,
  canEditUserMessage,
  editingMessageId,
  submittingEdit,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  message: ChatMessagesData;
  runByMessage?: ReadonlyMap<string, AgentRunData>;
} & EditProps) {
  if (message.role === 'user') {
    // 用户气泡（时间/编辑/复制）与 chat、task 模式共用同一组件，保证三模式一致
    return (
      <UserMessageBubble
        message={
          {
            id: message.id,
            role: 'user',
            content: message.content,
            datetime: message.datetime,
          } as ChatMessageData
        }
        editable={!!canEditUserMessage}
        editing={editingMessageId === message.id}
        submitting={!!submittingEdit && editingMessageId === message.id}
        onStartEdit={() => onStartEdit?.(message.id)}
        onCancelEdit={onCancelEdit}
        onSubmitEdit={(next) => onSubmitEdit?.(message.id, next)}
      />
    );
  }

  return (
    <AnalysisAssistantItem message={message} runByMessage={runByMessage} />
  );
}

/**
 * 块是否可渲染：空思考段与空正文块（流式占位期）不参与渲染，
 * 否则会在正文区留下空白，并把“流式占位 / 空回复兜底”挤掉。
 * 例外：运行中的「准备中」占位虽无内容，但要占一行状态标题，
 * 让用户看到 Agent 已启动（收尾后若仍为空则不再渲染）。
 */
function hasRenderableBlock(block: AIMessageContent): boolean {
  if (block.type === 'reasoning') {
    if (reasoningText(block).length > 0) return true;
    return block.status === 'streaming' && reasoningPhase(block) === 'preparing';
  }
  if (block.type === 'toolcall') return true;
  if (block.type === 'text' || block.type === 'markdown') {
    return typeof block.data === 'string' && block.data.length > 0;
  }
  return false;
}

/**
 * 过程块判定：思考段 / 工具动作行 / 过程叙述（narration）都属于「过程」，
 * 终态统一收进过程容器；不带 narration 标记的正文才是最终回答。
 */
function isProcessBlock(block: AIMessageContent): boolean {
  if (block.type === 'reasoning' || block.type === 'toolcall') return true;
  return isNarrationBlock(block);
}

/**
 * 渲染块序列（不含过程容器本身）：
 * - reasoning → “深度思考”折叠面板（默认随流式展开、终态收起）
 * - toolcall → 工具动作行；**连续同类动作聚合为一行**（借鉴 WorkBuddy：
 *   一轮并列的 5 条检索收成「联网搜索 5 条查询 ⌄」，展开看完整明细）
 * - markdown → 正文段落
 * 按事件到达顺序交错，完整复现「推理 → 行动 → 观察」闭环。
 */ 
function renderBlocks(blocks: AIMessageContent[]) {
  const nodes: React.ReactNode[] = [];
  let idx = 0;

  while (idx < blocks.length) {
    const block = blocks[idx]!;
    if (!hasRenderableBlock(block)) {
      idx += 1;
      continue;
    }

    if (block.type === 'toolcall') {
      // 向后收集「连续同类」动作（图标类别一致）——并列调用天然相邻
      const first = block as TaoToolBlock;
      const firstDesc = describeToolAction(first.data?.toolCallName ?? '', first.data?.args);
      let end = idx + 1;
      while (end < blocks.length) {
        const next = blocks[end]!;
        if (next.type !== 'toolcall' || !hasRenderableBlock(next)) break;
        const tb = next as TaoToolBlock;
        const desc = describeToolAction(tb.data?.toolCallName ?? '', tb.data?.args);
        if (desc.icon !== firstDesc.icon) break;
        end += 1;
      }

      const group = blocks.slice(idx, end) as TaoToolBlock[];
      if (group.length >= 2) {
        nodes.push(
          <ToolBatchRow
            key={`toolbatch-${idx}`}
            verb={firstDesc.verb}
            icon={firstDesc.icon}
            items={group.map((tb) => ({
              toolName: tb.data?.toolCallName ?? '',
              args: tb.data?.args,
              result: tb.data?.result,
              streaming: tb.status === 'streaming',
              failed: tb.status === 'stop',
            }))}
          />,
        );
      } else {
        nodes.push(
          <ToolCallRow
            key={`toolcall-${idx}`}
            toolName={first.data?.toolCallName ?? ''}
            args={first.data?.args}
            result={first.data?.result}
            streaming={first.status === 'streaming'}
            failed={first.status === 'stop'}
          />,
        );
      }
      idx = end;
      continue;
    }

    if (block.type === 'reasoning') {
      nodes.push(
        <ReasoningBlock
          key={`reasoning-${idx}`}
          text={reasoningText(block)}
          streaming={block.status === 'streaming'}
          phase={reasoningPhase(block)}
        />,
      );
      idx += 1;
      continue;
    }

    if (
      (block.type === 'text' || block.type === 'markdown') &&
      typeof block.data === 'string'
    ) {
      nodes.push(<Markdown key={`${block.type}-${idx}`} content={block.data} />);
    }
    idx += 1;
  }

  return nodes;
}

/**
 * TAO 块序列渲染：
 * - 过程块（思考/叙述/动作行）→ 收进过程容器：运行中展开并显示实时计时，
 *   终态自动收起为一行摘要（借鉴豆包工作，避免多轮过程把正文推长）；
 * - 回答正文 → 渲染在容器之后，保持正文区简洁。
 * 切分规则：过程块在前、回答在后（后端按 TAO 顺序产出），取最后一个过程块位置切分。
 */
function TaoBlockSequence({
  blocks,
  streaming,
  durationMs,
}: {
  blocks: AIMessageContent[];
  streaming: boolean;
  durationMs?: number | null;
}) {
  const lastProcessIdx = blocks.reduce(
    (acc, b, i) => (isProcessBlock(b) ? i : acc),
    -1,
  );
  const processBlocks = lastProcessIdx >= 0 ? blocks.slice(0, lastProcessIdx + 1) : [];
  const answerBlocks = lastProcessIdx >= 0 ? blocks.slice(lastProcessIdx + 1) : blocks;

  return (
    <>
      {processBlocks.length > 0 && (
        <ProcessContainer
          streaming={streaming}
          durationMs={durationMs ?? null}
        >
          {renderBlocks(processBlocks)}
        </ProcessContainer>
      )}
      {renderBlocks(answerBlocks)}
    </>
  );
}

function AnalysisAssistantItem({
  message,
  runByMessage,
}: {
  message: ChatMessagesData;
  runByMessage?: ReadonlyMap<string, AgentRunData>;
}) {
  // converter 下发的历史反馈（like/dislike/none）→ 评论状态
  const feedback = (message as { feedback?: string }).feedback;
  const [comment, setComment] = useState<ChatComment>(
    (message as { comment?: ChatComment }).comment ??
      (feedback === 'like' ? 'good' : feedback === 'dislike' ? 'bad' : ''),
  );

  const text = extractText(message);
  // TAO 块序列（reasoning / toolcall / markdown 按事件顺序交错）
  // 仅 assistant 分支进入本组件，content 为 AIMessageContent[]
  const blocks = (message.content ?? []) as AIMessageContent[];
  const hasProcess = blocks.some(
    (b) =>
      b.type === 'toolcall' ||
      (b.type === 'reasoning' && reasoningText(b).length > 0),
  );
  const hasRenderable = blocks.some(hasRenderableBlock);
  const isStreaming = message.status === 'streaming';
  const isFinal =
    message.status === 'complete' ||
    message.status === 'stop' ||
    message.status === 'error' ||
    (!message.status && (text.length > 0 || hasProcess));
  /**
   * 空回复兜底：run 正常结束（status='complete'）但**没有任何最终回答**时给出提示，
   * 不能渲染成 null —— 那会让整条消息在界面上完全消失，用户无从判断
   * 「Agent 没回复」还是「页面坏了」。
   *
   * 触发场景：
   *   - 模型输出被长度上限截断（content=''，后端不发 RUN_ERROR）；
   *   - 工具轮次触顶被中止：只有过程叙述（narration）没有最终回答。
   * `text` 已排除 narration（blocksToPlainText 口径），因此"只有过程话术"也算空回答，
   * 与过程块是否存在无关（过程块可能很多，但都不是回答）。
   * 仍只对 complete 生效：streaming / HITL 占位（无 status）不误报。
   */
  const isEmptyFinal = !text && !isStreaming && message.status === 'complete';

  /** 点踩/点赞：再点一次取消 */
  const toggleFeedback = (next: 'good' | 'bad') => {
    const newComment: ChatComment = comment === next ? '' : next;
    const previous = comment;
    setComment(newComment);
    const apiValue = { '': 'none', good: 'like', bad: 'dislike' } as const;
    feedbackMessage(message.id, apiValue[newComment]).catch(() => {
      setComment(previous);
      toast.error('反馈失败，请重试');
    });
  };

  const handleCopy = () => {
    if (!text) {
      toast.info('暂无可复制的内容');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('已复制'))
      .catch(() => toast.error('复制失败，请手动选择文本'));
  };

  const handleShare = () => {
    if (!text) {
      toast.info('暂无可分享的内容');
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success('已复制消息内容，可粘贴分享'))
      .catch(() => toast.info('复制失败，请手动选择文本'));
  };

  const actions: ReadonlyArray<{
    key: string;
    label: string;
    icon: ComponentType<ActionIconProps>;
    active?: boolean;
    onClick: () => void;
  }> = [
    { key: 'copy', label: '复制', icon: Copy, onClick: handleCopy },
    {
      key: 'good',
      label: '赞',
      icon: ThumbsUp,
      active: comment === 'good',
      onClick: () => toggleFeedback('good'),
    },
    {
      key: 'bad',
      label: '踩',
      icon: ThumbsDown,
      active: comment === 'bad',
      onClick: () => toggleFeedback('bad'),
    },
    { key: 'share', label: '分享', icon: ShareForwardIcon, onClick: handleShare },
  ];

  return (
    <div className="chat-msg-row chat-msg-row--ai">
      <div className="chat-msg-ai-body">
        {hasRenderable ? (
          <TaoBlockSequence
            blocks={blocks}
            streaming={isStreaming}
            durationMs={runByMessage?.get(message.id)?.durationMs ?? null}
          />
        ) : isStreaming ? (
          <span className="chat-streaming-placeholder" />
        ) : null}

        {isEmptyFinal && (
          <span className="chat-empty-response">
            Agent 本轮未产出完整回答（可能已达到工具调用上限或被中止），过程见上方。
            可以重试、缩小问题范围，或直接要求「用已有信息作答」。
          </span>
        )}

        {isFinal && (
          <>
            <div className="chat-action-bar" role="toolbar" aria-label="消息操作">
              <span className="chat-action-group">
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className={`chat-action-btn chat-tooltip${a.active ? ' is-active' : ''}`}
                      aria-label={a.label}
                      data-tooltip={a.label}
                      aria-pressed={a.active ?? false}
                      onClick={a.onClick}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </span>
            </div>
            {runByMessage?.has(message.id) && (
              <RunTrace
                runId={runByMessage.get(message.id)!.id}
                initialRun={runByMessage.get(message.id)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="chat-msg-row chat-msg-row--ai">
      <div className="chat-typing" aria-label="正在输入">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function AnalysisMessageList({
  messages,
  status,
  runByMessage,
  canEditUserMessage,
  editingMessageId,
  submittingEdit,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  /** 离开底部（底部哨兵不可见）时显示"回到底部"按钮 */
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // 底部哨兵：判断用户是否在底部附近，用于自动滚动 + 回到底部按钮显隐。
  // 依赖 hasMessages：空态（历史加载中）时哨兵尚未渲染、ref 为 null，
  // 消息到位后必须重建监听，否则近底部判定与按钮显隐会永久失效
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (!hasMessages) return;
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isNearBottomRef.current = entry.isIntersecting;
        setShowScrollToBottom(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMessages]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, status]);

  if (messages.length === 0) {
    return (
      <div className="pro-messages-empty">
        <div className="pro-empty-icon">
          <EmptyStateGlyph variant="pro" />
        </div>
        <div className="pro-empty-title">智能分析</div>
        <div className="pro-empty-desc">输入分析需求，Agent 将自动拆解步骤并执行</div>
      </div>
    );
  }

  return (
    <div className="pro-messages">
      <div className="chat-messages">
        {messages.map((msg) => (
          <AnalysisMessageItem
            key={msg.id}
            message={msg}
            runByMessage={runByMessage}
            canEditUserMessage={canEditUserMessage}
            editingMessageId={editingMessageId}
            submittingEdit={submittingEdit}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSubmitEdit={onSubmitEdit}
          />
        ))}
        {status === 'pending' && <TypingDots />}
        <div ref={bottomRef} />
      </div>

      <ScrollToBottomButton visible={showScrollToBottom} targetRef={bottomRef} />
    </div>
  );
}
