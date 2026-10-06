import { useEffect, useState } from 'react';
import { X, ArrowLeft, ExternalLink, Loader2, FileWarning } from 'lucide-react';
import { useSourcesPanelStore } from '../../../../store/sourcesPanelStore';
import { useAppStore } from '../../../../store/appStore';
import { getAuthHeader } from '../../../../api/client';
import { SourceFavicon } from './SourceFavicon';
import './sourcesPanel.css';

/**
 * 参考来源右侧面板（chat 模式）
 *
 * 两级视图：
 *   1. 列表态：来源卡片（序号 + 标题 + favicon/站点 + 摘要），对齐主流 AI 搜索产品
 *   2. 阅读态：经后端 /web/preview 代理净化后的网页，在 sandbox iframe 中渲染，
 *      绕开目标站点 X-Frame-Options 限制；失败/JS 重渲染站点给"新标签打开"兜底
 */
export function SourcesPanel() {
  const open = useSourcesPanelStore((s) => s.open);
  const sources = useSourcesPanelStore((s) => s.sources);
  const activeSource = useSourcesPanelStore((s) => s.activeSource);
  const previewSource = useSourcesPanelStore((s) => s.previewSource);
  const backToList = useSourcesPanelStore((s) => s.backToList);
  const closePanel = useSourcesPanelStore((s) => s.closePanel);
  const width = useAppStore((s) => s.sourcesWidth);

  if (!open) return null;

  return (
    <aside className="sources-panel" style={{ width, minWidth: width }}>
      {activeSource ? (
        <SourceReader
          key={activeSource.url || activeSource.title}
          source={activeSource}
          onBack={backToList}
          onClose={closePanel}
        />
      ) : (
        <>
          <div className="sources-panel-header">
            <span className="sources-panel-title">参考来源（{sources.length}）</span>
            <button
              type="button"
              className="sources-panel-btn"
              onClick={closePanel}
              aria-label="关闭来源面板"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
          <div className="sources-panel-body">
            <div className="sources-panel-list">
              {sources.map((src, i) => (
                <button
                  type="button"
                  key={`${src.url}-${i}`}
                  className="source-card"
                  onClick={() => previewSource(src)}
                >
                  <span className="source-card-index">{i + 1}</span>
                  <span className="source-card-body">
                    <span className="source-card-title">{src.title || '(无标题)'}</span>
                    <span className="source-card-site">
                      <SourceFavicon source={src} size={14} />
                      {getSourceSiteText(src)}
                    </span>
                    {src.content && (
                      <span className="source-card-snippet">{src.content}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function getSourceSiteText(src: { site?: string; url?: string }): string {
  if (src.site) return src.site;
  if (src.url) {
    try {
      return new URL(src.url).hostname.replace(/^www\./, '');
    } catch {
      return ''
    }
  }
  return '';
}

type ReaderState = 'loading' | 'ready' | 'error';

function SourceReader({
  source,
  onBack,
  onClose,
}: {
  source: { title?: string; url?: string; content?: string; site?: string }
  onBack: () => void
  onClose: () => void
}) {
  const [state, setState] = useState<ReaderState>('loading');
  const [doc, setDoc] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!source.url) {
      setState('error');
      setErrorMsg('该来源没有可访问的原文链接');
      return;
    }

    const controller = new AbortController();
    setDoc('');
    setState('loading');

    // 先走后端阅读代理（同源 /api，Authorization 头可用）；成功后以 srcDoc
    // 注入无 allow-scripts 的 sandbox iframe，失败则展示兜底卡片
    fetch(
      `/api/web/preview?url=${encodeURIComponent(source.url)}`,
      { headers: getAuthHeader(), signal: controller.signal },
    )
      .then(async (resp) => {
        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          throw new Error(data?.message || `预览服务返回 ${resp.status}`);
        }
        const html = await resp.text();
        setDoc(html);
        setState('ready');
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return;
        setState('error');
        setErrorMsg((e as Error)?.message || '网页预览失败');
      });

    return () => controller.abort();
  }, [source.url]);

  return (
    <>
      <div className="sources-panel-header source-reader-header">
        <button
          type="button"
          className="sources-panel-btn"
          onClick={onBack}
          aria-label="返回来源列表"
          title="返回"
        >
          <ArrowLeft size={16} />
        </button>
        <span
          className="sources-panel-title source-reader-title"
          title={source.site ? `${source.title || '网页预览'} · ${source.site}` : source.title}
        >
          {source.title || '网页预览'}
        </span>
        {source.url && (
          <a
            className="sources-panel-btn"
            href={source.url}
            target="_blank"
            rel="noreferrer"
            aria-label="在新标签页打开原文"
            title="新标签页打开"
          >
            <ExternalLink size={16} />
          </a>
        )}
        <button
          type="button"
          className="sources-panel-btn"
          onClick={onClose}
          aria-label="关闭来源面板"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>

      <div className="sources-panel-body source-reader-body">
        {state === 'loading' && (
          <div className="source-reader-hint">
            <Loader2 size={22} className="source-reader-spinner" />
            <span>正在加载网页预览…</span>
          </div>
        )}
        {state === 'error' && (
          <div className="source-reader-hint source-reader-error-card">
            <FileWarning size={26} />
            <p className="source-reader-error-msg">{errorMsg}</p>
            {source.content && <p className="source-reader-error-snippet">{source.content}</p>}
            {source.url && (
              <a
                className="source-reader-open-link"
                href={source.url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} />
                在新标签页打开原文
              </a>
            )}
          </div>
        )}
        {state === 'ready' && (
          <iframe
            className="source-reader-iframe"
            title={source.title || '网页预览'}
            srcDoc={doc}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </>
  );
}
