/**
 * TAO 有序块（Thought - Action - Observation）—— 消息内容的交错序列模型
 *
 * 目标形态（pro 分析模式）：把 ReAct 的推理-行动-观察闭环按事件到达顺序
 * 内联在消息正文里，而不是把 thinking/tool 分流到独立面板：
 *
 *   [reasoning 深度思考段]
 *   [toolcall 动作行]（观测结果内联在该行的展开区）
 *   [reasoning 深度思考段]
 *   [toolcall 动作行]
 *   ...
 *   [markdown 正文段落]
 *
 * 复用 types/chat.ts 的 AIMessageContent 联合类型（已存在 reasoning / toolcall /
 * markdown），因此这些块可直接存放于 message.content，被 chat/task/pro 共享消费。
 *
 * 本模块为纯函数 + 不可变更新（每次返回新数组/新块对象），供 useAgentChat（实时流）
 * 与 converter（历史恢复）共用，保证两条路径产出完全同构的块序列。
 */
import type {
  AIMessageContent,
  ChatMessageStatus,
  ReasoningContent,
  ToolCallContent,
  MarkdownContent,
} from '../types/chat';

/** 块级状态：与消息状态同源（streaming 表示该块仍在接收增量） */
export type TaoBlockStatus = Extract<ChatMessageStatus, 'streaming' | 'complete'>;

export type TaoReasoningBlock = ReasoningContent;
export type TaoToolBlock = ToolCallContent;
export type TaoTextBlock = MarkdownContent;
export type TaoBlock = TaoReasoningBlock | TaoToolBlock | TaoTextBlock;

/** 兜底：外部数据（历史 contentBlocks 等）构造出的未知块不参与渲染 */
export function isRenderableBlock(block: AIMessageContent): boolean {
  return block.type === 'reasoning' || block.type === 'toolcall' || block.type === 'markdown';
}

// ========== 读取 ==========

/** reasoning 块文本（data 为 text 片段数组） */
export function reasoningText(block: TaoReasoningBlock): string {
  if (!Array.isArray(block.data)) return '';
  return block.data.map((c) => (typeof c.data === 'string' ? c.data : '')).join('');
}

/** 工具块是否已拿到观测结果 */
export function toolBlockHasObservation(block: TaoToolBlock): boolean {
  const result = block.data?.result;
  return typeof result === 'string' && result.length > 0;
}

/** 提取所有正文（复制/预览用，不含思考与工具过程） */
export function blocksToPlainText(blocks: AIMessageContent[] | undefined): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((c): c is TaoTextBlock => c.type === 'text' || c.type === 'markdown')
    .map((c) => (typeof c.data === 'string' ? c.data : ''))
    .join('\n');
}

/** 是否含可见正文（空回复兜底判定用） */
export function blocksHaveText(blocks: AIMessageContent[] | undefined): boolean {
  return blocksToPlainText(blocks).length > 0;
}

/** 是否含任意过程块（reasoning / toolcall），用于决定是否渲染过程区 */
export function blocksHaveProcess(blocks: AIMessageContent[] | undefined): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((c) => c.type === 'reasoning' || c.type === 'toolcall');
}

// ========== 构造 ==========

export function createReasoningBlock(
  text = '',
  status: TaoBlockStatus = 'streaming',
): TaoReasoningBlock {
  return {
    type: 'reasoning',
    data: [{ type: 'text', data: text, status: 'complete' }],
    status,
    // 流式期间展开（用户能看到推理推进）；终态由组件按需收起
    ext: { collapsed: false },
  };
}

export function createToolBlock(params: {
  toolCallId?: string;
  toolCallName: string;
  args?: string;
  status?: TaoBlockStatus;
}): TaoToolBlock {
  return {
    type: 'toolcall',
    data: {
      toolCallId: params.toolCallId ?? '',
      toolCallName: params.toolCallName,
      args: params.args ?? '',
    },
    status: params.status ?? 'streaming',
    // 默认折叠：动作行只显示一行摘要，点击展开参数/观测
    ext: { collapsed: true },
  };
}

export function createTextBlock(text = '', status: TaoBlockStatus = 'streaming'): TaoTextBlock {
  return { type: 'markdown', data: text, status };
}

// ========== 不可变更新 ==========

type Predicate = (block: AIMessageContent) => boolean;

/** 从后向前找第一个匹配块并替换（事件天然按序到达，最新块在尾部） */
function updateLast(
  blocks: AIMessageContent[],
  match: Predicate,
  updater: (block: AIMessageContent) => AIMessageContent,
): AIMessageContent[] {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (match(blocks[i]!)) {
      const next = blocks.slice();
      next[i] = updater(blocks[i]!);
      return next;
    }
  }
  return blocks;
}

const isStreaming = (b: AIMessageContent) => b.status === 'streaming';

/** 追加思考增量到当前流式思考块（无匹配块时新建，容错乱序/缺 START 的流） */
export function appendReasoningDelta(
  blocks: AIMessageContent[],
  delta: string,
): AIMessageContent[] {
  if (!delta) return blocks;
  const target = updateLast(
    blocks,
    (b) => b.type === 'reasoning' && isStreaming(b),
    (b) => {
      const rb = b as TaoReasoningBlock;
      const prev = reasoningText(rb);
      return {
        ...rb,
        data: [{ type: 'text' as const, data: prev + delta, status: 'complete' as const }],
      };
    },
  );
  if (target !== blocks) return target;
  return [...blocks, createReasoningBlock(delta)];
}

/** 收尾当前思考块 */
export function finalizeReasoning(blocks: AIMessageContent[]): AIMessageContent[] {
  return updateLast(
    blocks,
    (b) => b.type === 'reasoning' && isStreaming(b),
    (b) => ({ ...b, status: 'complete' as const }),
  );
}

/** 追加工具调用参数增量 */
export function appendToolArgs(blocks: AIMessageContent[], delta: string): AIMessageContent[] {
  if (!delta) return blocks;
  return updateLast(
    blocks,
    (b) => b.type === 'toolcall' && isStreaming(b),
    (b) => {
      const tb = b as TaoToolBlock;
      return {
        ...tb,
        data: { ...tb.data, args: `${tb.data?.args ?? ''}${delta}` },
      };
    },
  );
}

/**
 * 写入工具观测结果（Action → Observation 闭环）。
 * 匹配优先级：toolCallId 相等 → 最后一个尚无观测结果的工具块
 * （历史数据可能缺 executionId，实时流可能缺 toolCallId，两者都要能回填）。
 */
export function setToolObservation(
  blocks: AIMessageContent[],
  params: { toolCallId?: string; toolCallName?: string; result: string },
): AIMessageContent[] {
  const matches = (b: AIMessageContent): boolean => {
    if (b.type !== 'toolcall') return false;
    const tb = b as TaoToolBlock;
    if (params.toolCallId && tb.data?.toolCallId) {
      return tb.data.toolCallId === params.toolCallId;
    }
    return !toolBlockHasObservation(tb);
  };
  return updateLast(blocks, matches, (b) => {
    const tb = b as TaoToolBlock;
    return {
      ...tb,
      status: 'complete' as const,
      data: {
        ...tb.data,
        toolCallName: tb.data?.toolCallName || params.toolCallName || '',
        result: params.result,
      },
    };
  });
}

/** 追加正文增量：续写尾部流式 markdown 块，否则新建（最终回答可能分多段） */
export function appendTextDelta(blocks: AIMessageContent[], delta: string): AIMessageContent[] {
  if (!delta) return blocks;
  const target = updateLast(
    blocks,
    (b) => (b.type === 'markdown' || b.type === 'text') && isStreaming(b),
    (b) => ({ ...b, data: `${typeof b.data === 'string' ? b.data : ''}${delta}` }) as AIMessageContent,
  );
  if (target !== blocks) return target;
  return [...blocks, createTextBlock(delta)];
}

/** 追加一整段正文（错误信息、中止说明等）并立即收尾 */
export function appendTextBlock(
  blocks: AIMessageContent[],
  text: string,
  status: TaoBlockStatus = 'complete',
): AIMessageContent[] {
  if (!text) return blocks;
  return [...blocks, createTextBlock(text, status)];
}

/** 流收尾：所有 streaming 块置为 complete */
export function finalizeBlocks(blocks: AIMessageContent[]): AIMessageContent[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (isStreaming(b)) {
      changed = true;
      return { ...b, status: 'complete' as const };
    }
    return b;
  });
  return changed ? next : blocks;
}

/** 是否有未收尾的流式块（用于错误/中止时判定是否需要兜底补文案） */
export function hasStreamingBlock(blocks: AIMessageContent[]): boolean {
  return blocks.some(isStreaming);
}

// ========== 历史恢复：持久化 contentBlocks → TAO 块序列 ==========

/** 后端持久化块的松散结构（agent 通道；字段随版本演进，全部按需读取） */
export interface PersistedAgentBlock {
  type?: string;
  status?: string;
  /** thinking 段文本 / tool_result 观测摘要 */
  summary?: string;
  /** text_stream 正文 */
  text?: string;
  toolName?: string;
  executionId?: string;
  /** 工具参数 JSON（C 档后端补写） */
  args?: string;
  /** 思考轮次（C 档后端补写） */
  round?: number;
  /** 兼容旧口径：思考内容写在 reasoningContent 字段 */
  reasoningContent?: string;
}

/** 后端持久化块中属于 agent 通道（TAO 可还原）的类型集合 */
const AGENT_BLOCK_TYPES = new Set(['thinking', 'tool_call', 'tool_result', 'text_stream']);

/**
 * 判断 contentBlocks 是否来自 agent 通道（pro/task）。
 * chat 通道的块无 type 字段（只有 reasoningContent / sources），交由 converter
 * 的原有分支处理，避免两条口径互相污染。
 */
export function isAgentContentBlocks(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some(
    (b) => b && typeof b === 'object' && AGENT_BLOCK_TYPES.has(String((b as PersistedAgentBlock).type ?? '')),
  );
}

/**
 * 持久化 contentBlocks → TAO 块序列（历史回放）
 *
 * 后端按事件顺序 push 块（thinking / tool_call / tool_result / text_stream），
 * 本函数保持同样顺序还原为可渲染的交错序列，使历史消息与实时流产出同构：
 *   [思考段] [动作行(含观测)] [思考段] [动作行] ... [正文]
 *
 * 兼容性：老数据的 thinking 可能合并为单块且排在工具之前（无法精确交错），
 * 此时降级为“整体思考段 + 工具序列 + 正文”，仍保持可追溯。
 */
export function contentBlocksToTaoBlocks(blocks: unknown): AIMessageContent[] {
  if (!Array.isArray(blocks)) return [];
  let out: AIMessageContent[] = [];

  for (const raw of blocks as PersistedAgentBlock[]) {
    if (!raw || typeof raw !== 'object') continue;

    if (raw.type === 'thinking') {
      const text = raw.summary ?? '';
      if (text.trim()) out = [...out, createReasoningBlock(text, 'complete')];
      continue;
    }

    if (raw.type === 'tool_call') {
      out = [
        ...out,
        createToolBlock({
          toolCallId: raw.executionId,
          toolCallName: raw.toolName ?? '',
          args: raw.args,
          status: 'complete',
        }),
      ];
      continue;
    }

    if (raw.type === 'tool_result') {
      const result = raw.summary ?? '';
      const matched = setToolObservation(out, {
        toolCallId: raw.executionId,
        toolCallName: raw.toolName,
        result,
      });
      if (matched !== out) {
        out = matched;
        continue;
      }
      // 无对应 tool_call 块（数据缺块）：补一个只含观测的动作行，保证顺序不丢结果
      const orphan = createToolBlock({
        toolCallId: raw.executionId,
        toolCallName: raw.toolName ?? '',
        status: 'complete',
      });
      out = [...out, { ...orphan, data: { ...orphan.data, result } }];
      continue;
    }

    if (raw.type === 'text_stream') {
      const text = raw.text ?? '';
      if (text.trim()) out = [...out, createTextBlock(text, 'complete')];
      continue;
    }

    // 兼容旧口径：思考内容写在 reasoningContent 字段
    if (typeof raw.reasoningContent === 'string' && raw.reasoningContent.trim()) {
      out = [...out, createReasoningBlock(raw.reasoningContent, 'complete')];
    }
  }

  return out;
}
