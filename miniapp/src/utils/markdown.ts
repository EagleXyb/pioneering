/**
 * 轻量级 Markdown → HTML 解析器
 * 专为小程序 <RichText> 组件优化，只处理 AI 回复常用语法
 * 遵循跨端 Markdown 渲染优化方案规范
 */

/** 转义 HTML 特殊字符 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 处理行内元素：加粗、行内代码、链接 */
function parseInline(text: string): string {
  let result = escapeHtml(text);
  // 行内代码 `code`
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 加粗 **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 链接 [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return result;
}

/**
 * 将 Markdown 文本解析为 HTML，供小程序 <RichText> 渲染
 * 支持：三级标题、无序列表、加粗、行内代码、代码块、段落、引用、分割线
 */
export function markdownToHtml(md: string): string {
  if (!md) return '';

  const lines = md.split('\n');
  const htmlParts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行跳过
    if (trimmed === '') {
      i++;
      continue;
    }

    // 代码块 ```...```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // 跳过结束 ```
      htmlParts.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
      continue;
    }

    // 三级标题 ### (文档规范：只使用三级标题)
    if (trimmed.startsWith('### ')) {
      htmlParts.push(`<h3>${parseInline(trimmed.slice(4))}</h3>`);
      i++;
      continue;
    }

    // 一级标题 # 和二级标题 ## (兼容AI可能输出的其他标题级别)
    if (trimmed.startsWith('## ')) {
      htmlParts.push(`<h3>${parseInline(trimmed.slice(3))}</h3>`);
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      htmlParts.push(`<h3>${parseInline(trimmed.slice(2))}</h3>`);
      i++;
      continue;
    }

    // 引用块 >
    if (trimmed.startsWith('> ')) {
      htmlParts.push(`<blockquote>${parseInline(trimmed.slice(2))}</blockquote>`);
      i++;
      continue;
    }

    // 分割线 --- 或 ***
    if (/^[-*]{3,}$/.test(trimmed)) {
      htmlParts.push('<hr/>');
      i++;
      continue;
    }

    // 无序列表 - (文档规范：统一使用无序列表)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const listItems: string[] = [];
      while (i < lines.length) {
        const listLine = lines[i].trim();
        if (listLine.startsWith('- ') || listLine.startsWith('* ')) {
          listItems.push(`<li>${parseInline(listLine.slice(2))}</li>`);
          i++;
        } else {
          break;
        }
      }
      htmlParts.push(`<ul>${listItems.join('')}</ul>`);
      continue;
    }

    // 普通段落：合并连续非空行
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pLine = lines[i].trim();
      if (pLine === '' || pLine.startsWith('#') || pLine.startsWith('- ') || pLine.startsWith('* ') || pLine.startsWith('>') || pLine.startsWith('```') || /^[-*]{3,}$/.test(pLine)) {
        break;
      }
      paraLines.push(pLine);
      i++;
    }
    if (paraLines.length > 0) {
      htmlParts.push(`<p>${parseInline(paraLines.join(' '))}</p>`);
    }
  }

  return htmlParts.join('');
}
