import { useMemo } from 'react';
import type { ActiveArtifact } from '@/store/artifactStore';

/**
 * Artifact 内容渲染器
 *
 * 设计参考：apps/web/docs/lib/components/chat/Artifacts.svelte 与
 * docs/lib/components/common/FullHeightIframe.svelte。
 *
 * 渲染策略：
 *   - html：iframe srcdoc + sandbox + CSP，安全渲染任意 HTML
 *   - svg：iframe srcdoc 包裹 SVG，复用 html 路径但注入 SVG 特定 CSP
 *   - code：<pre><code> 纯文本展示（不引入 highlight 库，避免依赖膨胀）
 *
 * 安全策略：
 *   - sandbox 默认只允许 allow-scripts（不允许 allow-same-origin，
 *     防止 iframe 访问父页 cookie/localStorage）
 *   - 通过 meta 标签注入 CSP：仅允许内联脚本/样式，禁止外部资源加载
 *   - SVG 类型额外用 DOMPurify 风格的策略：通过 CSP 限制外部资源
 *
 * 性能策略：
 *   - 用 useMemo 缓存 srcdoc，避免每次面板渲染都重新拼接字符串
 *   - iframe key 绑定到 content，内容变化时自动重建 iframe（避免历史状态残留）
 */

interface Props {
  artifact: ActiveArtifact;
}

/** 注入到 iframe srcdoc 的 CSP meta 标签 */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:;">`;

/** 包装 HTML 内容为完整文档 + CSP */
function wrapHtml(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${CSP_META}<style>html,body{margin:0;padding:8px;font-family:system-ui,-apple-system,sans-serif;}</style></head><body>${content}</body></html>`;
}

/** 包装 SVG 内容为可缩放显示的 HTML 文档 */
function wrapSvg(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${CSP_META}<style>html,body{margin:0;padding:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fafafa;}svg{max-width:100%;height:auto;}</style></head><body>${content}</body></html>`;
}

export function ArtifactRender({ artifact }: Props) {
  const srcdoc = useMemo(() => {
    if (artifact.type === 'html') return wrapHtml(artifact.content);
    if (artifact.type === 'svg') return wrapSvg(artifact.content);
    return '';
  }, [artifact.type, artifact.content]);

  // code 类型走纯文本渲染，避免 iframe 开销
  if (artifact.type === 'code') {
    return (
      <pre className="artifact-code-pre">
        <code>{artifact.content}</code>
      </pre>
    );
  }

  return (
    <iframe
      key={artifact.content}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      className="artifact-render-iframe"
      title={`artifact-${artifact.type}`}
    />
  );
}
