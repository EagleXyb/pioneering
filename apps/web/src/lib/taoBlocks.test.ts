/**
 * taoBlocks 单元测试 —— TAO 有序块（推理-行动-观察）
 *
 * 锁定两类契约：
 * 1. 实时流写入（不可变更新）：思考/工具/正文按调用顺序交错，且就地续写正确目标块
 * 2. 历史恢复（contentBlocks → 块序列）：与实时流产出同构，工具观测按 id 归属
 */
import { describe, it, expect } from 'vitest';
import {
  appendReasoningDelta,
  appendTextBlock,
  appendTextDelta,
  appendToolArgs,
  blocksToPlainText,
  contentBlocksToTaoBlocks,
  createReasoningBlock,
  createTextBlock,
  createToolBlock,
  finalizeBlocks,
  finalizeReasoning,
  isAgentContentBlocks,
  reasoningText,
  setToolObservation,
  type TaoToolBlock,
} from './taoBlocks';
import type { AIMessageContent } from '../types/chat';

const typesOf = (blocks: AIMessageContent[]) => blocks.map((b) => b.type);

describe('taoBlocks — 实时流块操作', () => {
  it('思考/工具/正文按调用顺序交错，多个思考段互不粘连', () => {
    let blocks: AIMessageContent[] = [];
    blocks = [...blocks, createReasoningBlock()];
    blocks = appendReasoningDelta(blocks, '先读资料。');
    blocks = finalizeReasoning(blocks);
    blocks = [
      ...blocks,
      createToolBlock({ toolCallId: 't1', toolCallName: 'library' }),
    ];
    blocks = appendToolArgs(blocks, '{"skill":"library"}');
    blocks = setToolObservation(blocks, {
      toolCallId: 't1',
      toolCallName: 'library',
      result: '已加载',
    });
    blocks = [...blocks, createReasoningBlock()];
    blocks = appendReasoningDelta(blocks, '再核对节点。');
    blocks = finalizeReasoning(blocks);
    blocks = appendTextDelta(blocks, '最终回答');

    expect(typesOf(blocks)).toEqual([
      'reasoning',
      'toolcall',
      'reasoning',
      'markdown',
    ]);
    expect(reasoningText(blocks[0] as never)).toBe('先读资料。');
    expect(reasoningText(blocks[2] as never)).toBe('再核对节点。');

    const tool = blocks[1] as TaoToolBlock;
    expect(tool.data.args).toBe('{"skill":"library"}');
    expect(tool.data.result).toBe('已加载');
    expect(tool.status).toBe('complete');
  });

  it('正文增量续写尾部流式块；收尾后新文本开新块', () => {
    let blocks = appendTextDelta([], '第一段');
    blocks = appendTextDelta(blocks, '（续）');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.data).toBe('第一段（续）');

    blocks = finalizeBlocks(blocks);
    blocks = appendTextDelta(blocks, '第二段');
    expect(typesOf(blocks)).toEqual(['markdown', 'markdown']);
  });

  it('appendTextBlock 追加整段并立即收尾（错误/中止场景）', () => {
    let blocks = appendTextBlock([], '请求失败: x', 'complete');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('complete');
    expect(blocksToPlainText(blocks)).toBe('请求失败: x');
  });

  it('缺 TOOL_CALL_START 的乱序流：观测回填到最后一个未观测的工具块', () => {
    let blocks: AIMessageContent[] = [
      createToolBlock({ toolCallName: 'a' }),
      createToolBlock({ toolCallName: 'b' }),
    ];
    blocks = setToolObservation(blocks, { result: 'b-result' });
    const a = blocks[0] as TaoToolBlock;
    const b = blocks[1] as TaoToolBlock;
    expect(b.data.result).toBe('b-result');
    expect(a.data.result).toBeUndefined();
  });
});

describe('taoBlocks — 历史 contentBlocks 还原', () => {
  it('agent 通道块保序还原为交错序列，观测按 executionId 归属', () => {
    const blocks = contentBlocksToTaoBlocks([
      { type: 'thinking', status: 'success', summary: '第 1 轮思考', round: 1 },
      { type: 'tool_call', status: 'success', toolName: 'library', executionId: 't1', args: '{"skill":"library"}' },
      { type: 'tool_result', status: 'success', toolName: 'library', executionId: 't1', summary: '{"ok":true}' },
      { type: 'thinking', status: 'success', summary: '第 2 轮思考', round: 2 },
      { type: 'tool_call', status: 'success', toolName: 'read_file', executionId: 't2' },
      { type: 'tool_result', status: 'success', toolName: 'read_file', executionId: 't2', summary: '文件内容' },
      { type: 'text_stream', status: 'success', text: '最终回答' },
    ]);

    expect(typesOf(blocks)).toEqual([
      'reasoning',
      'toolcall',
      'reasoning',
      'toolcall',
      'markdown',
    ]);
    const tool1 = blocks[1] as TaoToolBlock;
    expect(tool1.data.toolCallId).toBe('t1');
    expect(tool1.data.result).toBe('{"ok":true}');
    const tool2 = blocks[3] as TaoToolBlock;
    expect(tool2.data.result).toBe('文件内容');
    expect(blocksToPlainText(blocks)).toBe('最终回答');
  });

  it('缺 executionId 的老数据：观测回填到前一个工具块', () => {
    const blocks = contentBlocksToTaoBlocks([
      { type: 'tool_call', status: 'success', toolName: 'search' },
      { type: 'tool_result', status: 'success', toolName: 'search', summary: '结果' },
    ]);
    expect(typesOf(blocks)).toEqual(['toolcall']);
    expect((blocks[0] as TaoToolBlock).data.result).toBe('结果');
  });

  it('孤立 tool_result（无 tool_call）补一个只含观测的动作行', () => {
    const blocks = contentBlocksToTaoBlocks([
      { type: 'tool_result', status: 'success', toolName: 'search', summary: '结果' },
    ]);
    expect(typesOf(blocks)).toEqual(['toolcall']);
    expect((blocks[0] as TaoToolBlock).data.result).toBe('结果');
  });

  it('空思考段/空文本段不产生块（避免历史回放出现空段落）', () => {
    const blocks = contentBlocksToTaoBlocks([
      { type: 'thinking', status: 'success', summary: '   ' },
      { type: 'text_stream', status: 'success', text: '' },
    ]);
    expect(blocks).toEqual([]);
  });

  it('兼容旧的 reasoningContent 口径', () => {
    const blocks = contentBlocksToTaoBlocks([{ reasoningContent: '旧口径思考' }]);
    expect(typesOf(blocks)).toEqual(['reasoning']);
    expect(reasoningText(blocks[0] as never)).toBe('旧口径思考');
  });

  it('isAgentContentBlocks 区分两条持久化通道', () => {
    expect(isAgentContentBlocks([{ type: 'thinking', summary: 'x' }])).toBe(true);
    expect(isAgentContentBlocks([{ type: 'text_stream', text: 'x' }])).toBe(true);
    // chat 通道：无 type 字段（仅 reasoningContent / sources）
    expect(isAgentContentBlocks([{ type: 'text', reasoningContent: 'x' }])).toBe(false);
    expect(isAgentContentBlocks([{ sources: [] }])).toBe(false);
    expect(isAgentContentBlocks([])).toBe(false);
    expect(isAgentContentBlocks(undefined)).toBe(false);
  });

  it('createTextBlock 生成的块可被复制文本提取', () => {
    const blocks = [createTextBlock('A'), createTextBlock('B')];
    expect(blocksToPlainText(blocks)).toBe('A\nB');
  });
});
