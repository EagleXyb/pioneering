import { useMemo, useState } from 'react';
import type { ReferenceItem } from '../../../../types/chat';

interface Props {
  source: ReferenceItem;
  size?: number;
  className?: string;
}

/** 从 source.site 或 url 提取域名；都不可用时返回空串 */
export function getSourceDomain(source: ReferenceItem): string {
  if (source.site && !source.site.includes(' ')) return source.site.replace(/^www\./, '');
  if (source.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      /* ignore */
    }
  }
  return '';
}

const FALLBACK_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9'];

/**
 * 站点 favicon：直连 https://<domain>/favicon.ico（不依赖境外 favicon 服务），
 * 加载失败时回退为站点首字母圆底。
 */
export function SourceFavicon({ source, size = 16, className }: Props) {
  const [failed, setFailed] = useState(false);
  const domain = useMemo(() => getSourceDomain(source), [source]);

  if (!domain) {
    return (
      <span
        className={`sources-favicon sources-favicon--fallback ${className ?? ''}`}
        style={{ width: size, height: size, fontSize: size * 0.6 }}
      >
        ?
      </span>
    );
  }

  if (failed) {
    const colorIndex = domain.charCodeAt(0) % FALLBACK_COLORS.length;
    return (
      <span
        className={`sources-favicon sources-favicon--fallback ${className ?? ''}`}
        style={{
          width: size,
          height: size,
          fontSize: size * 0.55,
          background: `${FALLBACK_COLORS[colorIndex]}22`,
          color: FALLBACK_COLORS[colorIndex],
        }}
      >
        {domain.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={`sources-favicon ${className ?? ''}`}
      style={{ width: size, height: size }}
      src={`https://${domain}/favicon.ico`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
