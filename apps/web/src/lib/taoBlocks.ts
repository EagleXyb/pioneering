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

/**
 * 块级状态：与消息状态同源。
 * - streaming：该块仍在接收增量
 * - complete：正常收尾
 * - stop：未完成（工具调用没等到观测结果就随 run 结束 —— 触顶/中止），UI 显示「未执行」
 */
export type TaoBlockStatus = Extract<ChatMessageStatus, 'streaming' | 'complete' | 'stop'>;

/**
 * 思考段的运行阶段（驱动“深度思考”标题的状态交互）：
 * - preparing：Agent 已启动、尚未产出思考内容 → 标题「准备中」
 * - thinking：思考进行中 → 标题「开始思考」
 * 思考段收尾（status='complete'）后不再需要该字段 → 标题回到「深度思考」并默认收起。
 */
export type TaoReasoningPhase = 'preparing' | 'thinking';

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

/** 思考段运行阶段（历史/终态块无该字段） */
export function reasoningPhase(block: TaoReasoningBlock): TaoReasoningPhase | undefined {
  const phase = block.ext?.phase;
  return phase === 'preparing' || phase === 'thinking' ? phase : undefined;
}

/** 工具块是否已拿到观测结果 */
export function toolBlockHasObservation(block: TaoToolBlock): boolean {
  const result = block.data?.result;
  return typeof result === 'string' && result.length > 0;
}

/**
 * 工具块是否至少执行过（观测事件到达过，含空结果）。
 * 与 toolBlockHasObservation 的差别：后者要求结果非空，用于「回填匹配」；
 * 本函数用于收尾判定 —— 从未执行过的调用才该显示「未执行」。
 */
export function toolBlockWasExecuted(block: TaoToolBlock): boolean {
  return block.ext?.observed === true || toolBlockHasObservation(block);
}

/**
 * 提取「回答」正文（复制/分享/预览用）。
 *
 * 排除思考、工具过程与**过程叙述段**（narration）：叙述是 Agent 边做边说的话，
 * 属于过程信息，不应混进用户要复制的回答里。
 */
export function blocksToPlainText(blocks: AIMessageContent[] | undefined): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter(
      (c): c is TaoTextBlock =>
        (c.type === 'text' || c.type === 'markdown') && !isNarrationBlock(c),
    )
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
  phase?: TaoReasoningPhase,
): TaoReasoningBlock {
  return {
    type: 'reasoning',
    data: [{ type: 'text', data: text, status: 'complete' }],
    status,
    // 流式期间展开（用户能看到推理推进）；终态由组件按需收起
    ext: { collapsed: false, ...(phase ? { phase } : {}) },
  };
}

/**
 * 运行启动占位：Agent 已收到请求、尚未产出思考内容（标题显示「准备中」）。
 * 收到 THINKING_START 后由 startThinkingBlock 就地提升为思考段。
 */
export function createPreparingBlock(): TaoReasoningBlock {
  return createReasoningBlock('', 'streaming', 'preparing');
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

export function createTextBlock(
  text = '',
  status: TaoBlockStatus = 'streaming',
  narration = false,
): TaoTextBlock {
  return {
    type: 'markdown',
    data: text,
    status,
    // 过程叙述标记：ReAct 中间轮叙述渲染在正文里（WorkBuddy 风格），
    // 但语义上属于过程信息 —— 复制/分享据此排除（见 blocksToPlainText）
    ...(narration ? { ext: { narration: true } } : {}),
  };
}

/** 是否过程叙述块（正文通道里的中间轮叙述，不属于「回答」） */
export function isNarrationBlock(block: AIMessageContent): boolean {
  if (block.type !== 'markdown' && block.type !== 'text') return false;
  return (block.ext as { narration?: boolean } | undefined)?.narration === true;
}

/**
 * 收尾当前流式正文块。
 *
 * 每段文本（叙述段 / 最终回答）独立成块：叙述收尾后，后续增量会在新块里继续，
 * 避免叙述与最终回答粘成同一段（对齐后端每段 TEXT_MESSAGE_START/END 的语义）。
 */
export function finalizeText(blocks: AIMessageContent[]): AIMessageContent[] {
  return updateLast(
    blocks,
    (b) => (b.type === 'markdown' || b.type === 'text') && isStreaming(b),
    (b) => ({ ...b, status: 'complete' as const }),
  );
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

/** 是否为空「准备中」占位块（标题状态交互：准备中 → 开始思考） */
function isPreparingPlaceholder(block: AIMessageContent): boolean {
  return (
    block.type === 'reasoning' &&
    isStreaming(block) &&
    reasoningText(block).length === 0 &&
    reasoningPhase(block) === 'preparing'
  );
}

/**
 * 收到 THINKING_START：把尾部「准备中」占位就地提升为思考段
 * （复用同一块的位置，标题从「准备中」切换为「开始思考」）；
 * 多轮 ReAct 的后续轮次没有占位，按常规新建思考段。
 */
export function startThinkingBlock(blocks: AIMessageContent[]): AIMessageContent[] {
  const last = blocks[blocks.length - 1];
  if (last && isPreparingPlaceholder(last)) {
    const next = blocks.slice();
    next[next.length - 1] = {
      ...last,
      ext: { ...(last.ext ?? {}), phase: 'thinking' as const },
    };
    return next;
  }
  return [...blocks, createReasoningBlock('', 'streaming', 'thinking')];
}

/**
 * 思考尚未开始即转入其他事件（工具调用 / 正文输出 / 收尾）：
 * 丢弃空的「准备中」占位，避免残留一行无内容的思考标题。
 */
export function dropPreparingBlock(blocks: AIMessageContent[]): AIMessageContent[] {
  const last = blocks[blocks.length - 1];
  return last && isPreparingPlaceholder(last) ? blocks.slice(0, -1) : blocks;
}

/** 追加思考增量到当前流式思考块（无匹配块时新建，容错乱序/缺 START 的流）；
 * 追加即视为思考已开始（容错缺失 THINKING_START 的流，标题脱离「准备中」） */
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
        ext: { ...(rb.ext ?? {}), phase: 'thinking' as const },
      };
    },
  );
  if (target !== blocks) return target;
  return [...blocks, createReasoningBlock(delta, 'streaming', 'thinking')];
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
      // 显式标记"确实拿到过观测"：工具返回空结果时也能与"从未执行"区分开
      ext: { ...tb.ext, observed: true },
      data: {
        ...tb.data,
        toolCallName: tb.data?.toolCallName || params.toolCallName || '',
        result: params.result,
      },
    };
  });
}

/**
 * 追加正文增量：续写尾部流式 markdown 块，否则新建（叙述段与最终回答各自成段）。
 *
 * @param narration 新建块时是否标记为过程叙述（仅新建生效：续写沿用既有块的身份）
 */
export function appendTextDelta(
  blocks: AIMessageContent[],
  delta: string,
  narration = false,
): AIMessageContent[] {
  if (!delta) return blocks;
  const target = updateLast(
    blocks,
    (b) => (b.type === 'markdown' || b.type === 'text') && isStreaming(b),
    (b) => ({ ...b, data: `${typeof b.data === 'string' ? b.data : ''}${delta}` }) as AIMessageContent,
  );
  if (target !== blocks) return target;
  return [...blocks, createTextBlock(delta, 'streaming', narration)];
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

/**
 * 流收尾：所有 streaming 块置为 complete。
 *
 * 例外（缺陷修复）：从未等到观测结果的工具块说明本轮 run 在该调用执行前就结束了
 * （工具轮次触顶 / 用户中止）—— 标记为 'stop'，UI 显示「未执行」，
 * 而不是像正常完成一样静默收尾。
 */
export function finalizeBlocks(blocks: AIMessageContent[]): AIMessageContent[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (!isStreaming(b)) return b;
    changed = true;
    if (b.type === 'toolcall' && !toolBlockWasExecuted(b as TaoToolBlock)) {
      return { ...b, status: 'stop' as const };
    }
    return { ...b, status: 'complete' as const };
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
  /** text_stream 是否为 ReAct 中间轮叙述（过程话术，复制/分享时排除） */
  narration?: boolean;
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
          // 落库 status='failed' = 该调用未执行（run 在此前结束）→ 显示「未执行」
          status: raw.status === 'failed' ? 'stop' : 'complete',
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
      // narration：ReAct 中间轮叙述（正文展示的过程话术），标记随块还原
      if (text.trim()) out = [...out, createTextBlock(text, 'complete', raw.narration === true)];
      continue;
    }

    // 兼容旧口径：思考内容写在 reasoningContent 字段
    if (typeof raw.reasoningContent === 'string' && raw.reasoningContent.trim()) {
      out = [...out, createReasoningBlock(raw.reasoningContent, 'complete')];
    }
  }

  return out;
}
