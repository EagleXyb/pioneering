/**
 * 模式边界机械化断言（T1.8 验收，对应《模式能力矩阵》PR 审查清单）
 *
 * 直接读取源码文本做 import / 引用级断言，保证边界不会随重构悄悄被破坏：
 *   1. chat 栈不引任何 @pioneering/* 包、不请求 /agent/* 端点
 *   2. chat 不挂 HITL（无 useHitlStore）
 *   3. pro 不出现 plan 相关字段/状态（不引 planExecuteStore、不引用 plan_execute）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), 'src/modes', rel), 'utf8');
}

describe('chat 栈隔离（不引入 Agent 能力）', () => {
  const sources = {
    hook: readSrc('chat/hooks/useAguiChat.ts'),
    mode: readSrc('chat/ChatMode.tsx'),
    input: readSrc('chat/components/ChatInput.tsx'),
  };

  it('chat 源码不 import @pioneering/* 包', () => {
    for (const [name, text] of Object.entries(sources)) {
      expect(text, name).not.toMatch(/@pioneering\//);
    }
  });

  it('chat 不请求 /agent/* 端点', () => {
    for (const [name, text] of Object.entries(sources)) {
      expect(text, name).not.toMatch(/['"`]\/?api\/agent\//);
      expect(text, name).not.toMatch(/agent\/completions|agent\/resume|agent\/state|agent\/abort/);
    }
  });

  it('chat 不挂 HITL（无 useHitlStore / HitlInlineCard）', () => {
    for (const [name, text] of Object.entries(sources)) {
      expect(text, name).not.toMatch(/useHitlStore|HitlInlineCard/);
    }
  });
});

describe('pro / task 不互相渗透', () => {
  const proHook = readSrc('pro/hooks/useAgentChat.ts');

  it('pro 不引 planExecuteStore', () => {
    expect(proHook).not.toMatch(/planExecuteStore/);
  });

  it('pro 不引用 plan_execute / STATE_DELTA plan 字段', () => {
    expect(proHook).not.toMatch(/plan_execute/);
    expect(proHook).not.toMatch(/applyPlanDelta|step_update/);
  });

  // 契约（packages/modu-agent/AGENTS.md:13）：pro 必须显式声明 react_agent，
  // 一旦退化为「不传、靠后端 schema 默认值」，后端默认值一变 pro 就会静默换图。
  it('pro 显式声明 agentMode=react_agent', () => {
    expect(proHook).toMatch(/agentMode:\s*'react_agent'/);
  });
});
