/**
 * 搜索结果卡片（WorkBuddy 风格：浅灰圆角卡片 + 来源列表）
 *
 * 联网搜索类工具（web_search 等）的观测结果不再铺原始 JSON，而是渲染为
 * 「站点图标 + 标题（可点开原文）」的来源列表；**全部检索条数逐条展示**，
 * 页脚展示「引擎 · 共 N 篇来源」；底部保留复制/原始数据入口，
 * 兼顾可读性与可追溯性（原始数据默认收起）。
 *
 * 识别与解析见 lib/toolResult.ts；非搜索类结果由 ToolCallRow 回退为 JSON 展示。
 */
import { useCallback, useState } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { resultDomain, type SearchResultItem } from '@/lib/toolResult';

interface Props {
  results: SearchResultItem[];
  /** 搜索引擎名（bing / tavily …），展示为“来源：xxx” */
  source?: string;
  /** 原始观测文本（已美化），供“原始数据”折叠查看 */
  raw: string;
}

const FALLBACK_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9'];

/**
 * 站点图标：直连 https://<domain>/favicon.ico（与 chat 来源面板同策略，
 * 不依赖第三方 favicon 服务）；无域名 / 加载失败时回退首字母色块。
 */
function SourceIcon({ title, url }: { title: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  const domain = resultDomain(url);

  if (!domain || failed) {
    const seed = domain || title;
    const color = FALLBACK_COLORS[seed.charCodeAt(0) % FALLBACK_COLORS.length];
    return (
      <span
        className="tao-source-icon tao-source-icon--letter"
        style={{ background: `${color}22`, color }}
        aria-hidden="true"
      >
        {seed.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="tao-source-icon"
      src={`https://${domain}/favicon.ico`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function SearchResultsCard({ results, source, raw }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = results
      .map((r, i) => `${i + 1}. ${r.title}${r.url ? `\n   ${r.url}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时静默降级 */
    }
  }, [results]);

  return (
    <div className="tao-tool-result-card">
      <ul className="tao-source-list">
        {results.map((item, idx) => {
          const href = item.url && /^https?:\/\//i.test(item.url) ? item.url : undefined;
          const title = <span className="tao-source-title">{item.title}</span>;
          return (
            <li key={`${item.url ?? item.title}-${idx}`} className="tao-source-item">
              <SourceIcon title={item.title} url={item.url} />
              {href ? (
                <a
                  className="tao-source-link"
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={href}
                >
                  {title}
                </a>
              ) : (
                <span className="tao-source-link tao-source-link--plain">{title}</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="tao-tool-result-foot">
        <span className="tao-tool-result-meta">
          {source ? `${source} · ` : ''}共 {results.length} 篇来源
        </span>
        <div className="tao-tool-result-actions">
          <button type="button" className="tao-tool-result-action" onClick={handleCopy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            className="tao-tool-result-action"
            aria-expanded={showRaw}
            onClick={() => setShowRaw((v) => !v)}
          >
            <ChevronRight
              size={12}
              className={`tao-tool-result-raw-chevron${showRaw ? ' is-open' : ''}`}
            />
            原始数据
          </button>
        </div>
      </div>

      <div
        className={`tao-tool-result-raw-wrap${showRaw ? ' is-open' : ''}`}
        aria-hidden={!showRaw}
      >
        <div className="tao-tool-result-raw-inner">
          <pre className="tao-tool-result-raw">{raw}</pre>
        </div>
      </div>
    </div>
  );
}
