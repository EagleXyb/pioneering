/**
 * 轻量代码块提取器
 *
 * 设计参考：docs/lib/components/chat/Chat.svelte:1283-1336 getContents() ——
 * OpenWebUI 通过遍历消息历史抽取 HTML/SVG 代码块作为 artifact 来源。
 *
 * 本项目不引入 react-markdown，改用正则识别 ```lang ... ``` 围栏代码块。
 * 适用于：
 *   - 完整消息内容（流式结束后）
 *   - 单条消息内部的多代码块场景
 *
 * 限制：
 *   - 不处理嵌套围栏（``` ``` 内嵌 ``` ```）——LLM 极少生成这种结构
 *   - 不处理缩进式代码块（4 空格缩进）——现代 LLM 普遍用围栏式
 *   - 语言标签不区分大小写，统一转小写
 */

export interface CodeBlock {
  /** 代码块语言（小写，无 language- 前缀），如 'html' / 'svg' / 'python' */
  language: string;
  /** 代码块内容（已去除围栏） */
  code: string;
  /** 代码块在原文中的起始偏移（用于调试 / 定位） */
  start: number;
  /** 代码块在原文中的结束偏移 */
  end: number;
}

/** 围栏代码块正则：```lang\n ... \n``` 或 ~~~lang\n ... \n~~~ */
const FENCE_RE = /(^|\n)(?<fence>```|~~~)(?<lang>[^\n`]*)\n(?<code>[\s\S]*?)\n\k<fence>/g;

/**
 * 从文本中提取所有围栏代码块
 *
 * @param text 消息文本（可能含多个代码块）
 * @returns 代码块数组，按出现顺序排列；无代码块时返回空数组
 */
export function extractCodeBlocks(text: string): CodeBlock[] {
  if (!text) return [];
  const blocks: CodeBlock[] = [];
  // 重置 lastIndex（全局正则复用时必要）
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const lang = (match.groups?.lang || '').trim().toLowerCase();
    const code = match.groups?.code || '';
    // start/end 相对原文的偏移（含前缀 \n）
    const start = match.index + (match[1] || '').length;
    blocks.push({
      language: lang,
      code,
      start,
      end: start + match[0].length - (match[1] || '').length,
    });
  }
  return blocks;
}

/**
 * 判断代码块是否可预览为 artifact
 *
 * 仅 html / svg 可在 iframe 中渲染；其他语言走纯文本 code 渲染。
 */
export function isPreviewable(language: string): boolean {
  return language === 'html' || language === 'svg';
}
