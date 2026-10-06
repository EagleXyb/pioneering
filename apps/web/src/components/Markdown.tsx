/**
 * Markdown 统一渲染器（阶段 4.4）
 *
 * 替换原 206 行零依赖正则渲染器：react-markdown + remark-gfm（表格/删除线/
 * 任务列表）+ rehype-highlight（代码高亮）+ rehype-sanitize（XSS 白名单）。
 * 与 apps/desktop 的 MarkdownRenderer 同源策略（sanitize schema / SafeLink /
 * 代码块复制），chat 与 task/pro 的消息渲染共用本组件。
 *
 * 视觉样式见 tailwind.css 的 .chat-markdown 层。
 */
import { memo, useState, useCallback, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema, type Schema as SanitizeSchema } from 'hast-util-sanitize';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface MarkdownProps {
  content: string;
  className?: string;
}

// 自定义 sanitize schema：默认白名单 + 放开 code/span 的 className
// （rehype-highlight 的语言标识与 hljs token 着色依赖），href 收紧为
// http(s)/mailto，剥离 on* 事件与危险协议。
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        '*'
      ] as string[] | undefined) ?? []),
      'className',
    ],
    code: [
      ...(((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'code'
      ] as string[] | undefined) ?? []),
      'className',
    ],
    span: [
      ...(((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'span'
      ] as string[] | undefined) ?? []),
      'className',
    ],
    a: [
      ...(((defaultSchema.attributes as Record<string, unknown> | undefined)?.[
        'a'
      ] as string[] | undefined) ?? []),
      'href',
      'target',
      'rel',
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
};

/** 链接白名单：仅放行 http(s)，其余降级为纯文本，阻断 javascript: 等 XSS */
function SafeLink({
  href,
  children,
  node: _node,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  // react-markdown v9 会注入 node 对象，必须解构剔除，否则会被透传成
  // DOM 上的 node="[object Object]" 游离属性
  node?: unknown;
}) {
  const safe = typeof href === 'string' && /^https?:\/\//i.test(href);
  if (!safe) {
    return <span>{children}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  );
}

/** 代码块：语言标识 + 一键复制；pre 透传避免双重包裹 */
function CodeBlock({
  className,
  children,
  raw,
}: {
  className?: string;
  children: ReactNode;
  raw: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      toast.success('代码已复制');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  }, [raw]);

  const language = /language-([\w-]+)/.exec(className || '')?.[1] ?? '';

  return (
    <div className="chat-code-block">
      <div className="chat-code-block-header">
        <span className="chat-code-block-lang">{language || 'text'}</span>
        <button
          type="button"
          className="chat-code-block-copy"
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre className="chat-code-block-pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/** 从 ReactMarkdown code 组件 props 中提取原始文本 */
function nodeToText(node: unknown): string {
  if (node == null) return '';
  const n = node as { value?: string; children?: Array<{ value?: string }> };
  if (typeof n.value === 'string') return n.value;
  if (Array.isArray(n.children)) {
    return n.children.map((c) => c.value ?? '').join('');
  }
  return '';
}

export const Markdown = memo(function Markdown({
  content,
  className,
}: MarkdownProps) {
  return (
    <div className={`chat-markdown${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a: SafeLink,
          // pre 直接吐出子节点：围栏代码由自定义 code 渲染成卡片，
          // 避免 pre>div 的非法嵌套
          pre: ({ children }) => <>{children}</>,
          code: ({ node, className: cls, children }) => {
            const raw = nodeToText(node);
            const hasLang = /language-/.test(cls || '');
            const isBlock = hasLang || raw.includes('\n');
            if (!isBlock) {
              return <code className={cls}>{children}</code>;
            }
            return (
              <CodeBlock className={cls} raw={raw.replace(/\n$/, '')}>
                {children}
              </CodeBlock>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
