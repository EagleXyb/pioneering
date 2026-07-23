import React from 'react';

interface MarkdownProps {
  content: string;
  className?: string;
}

// 行内语法：**加粗**、`行内代码`、*斜体*
const INLINE_RE = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(<code key={`${keyBase}-c${i}`} className="md-code">{m[3]}</code>);
    } else if (m[4] !== undefined) {
      nodes.push(<em key={`${keyBase}-i${i}`}>{m[4]}</em>);
    }
    last = INLINE_RE.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * 轻量 markdown 渲染器（零依赖，契合项目"不引入 react-markdown"的约定）。
 *
 * 支持本项目 AI 回复中常见的语法：
 *   - 标题 # ~ ######
 *   - 加粗 **x** / 斜体 *x* / 行内代码 `x`
 *   - 无序列表 - * + / 有序列表 1.
 *   - 分割线 --- *** ___
 *   - 引用 > x
 *   - 围栏代码块 ```lang
 *   - 开头的原始 JSON（如规划 plan）自动渲染为代码块
 *
 * 不支持表格、嵌套结构等高级语法，足以覆盖对话场景。
 */
export function Markdown({ content, className }: MarkdownProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isHeading = (l: string) => /^(#{1,6})\s+/.test(l);
  const isList = (l: string) => /^[-*+]\s+/.test(l);
  const isOrdered = (l: string) => /^\d+\.\s+/.test(l);
  const isQuote = (l: string) => /^>\s?/.test(l);
  const isFence = (l: string) => /^```/.test(l);
  const isHr = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    if (isFence(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      blocks.push(
        <pre key={key++} className="md-pre">
          <code className={lang ? `language-${lang}` : undefined}>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 标题
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = Math.min(hm[1].length, 6) - 1;
      const Tag = HEADING_TAGS[level];
      blocks.push(
        <Tag key={key++} className={`md-h md-h${level + 1}`}>
          {renderInline(hm[2], `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // 分割线
    if (isHr(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // 无序列表
    if (isList(line)) {
      const items: string[] = [];
      while (i < lines.length && isList(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 有序列表
    if (isOrdered(line)) {
      const items: string[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // 引用
    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="md-quote">
          {renderInline(buf.join(' '), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // 原始 JSON（如规划 plan）渲染为代码块
    if (line.trim().startsWith('{')) {
      const buf: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim() !== '') {
        buf.push(lines[j]);
        j++;
      }
      const raw = buf.join('\n');
      try {
        JSON.parse(raw);
        blocks.push(
          <pre key={key++} className="md-pre md-pre-json">
            <code>{raw}</code>
          </pre>,
        );
        i = j;
        continue;
      } catch {
        // 非合法 JSON，按普通段落处理
      }
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 段落
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isHeading(lines[i]) &&
      !isList(lines[i]) &&
      !isOrdered(lines[i]) &&
      !isQuote(lines[i]) &&
      !isFence(lines[i]) &&
      !isHr(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="md-p">
        {renderInline(para.join('\n'), `p${key}`)}
      </p>,
    );
  }

  return <div className={className ? `markdown-body ${className}` : 'markdown-body'}>{blocks}</div>;
}
