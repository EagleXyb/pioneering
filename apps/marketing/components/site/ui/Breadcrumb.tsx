import Link from 'next/link'
import { BRAND_SITE } from '@/data/site/site'

// ============================================================
// Breadcrumb · 内页面包屑 + BreadcrumbList JSON-LD（IA 6.2 要求）
// item 字段按 schema.org 要求输出绝对 URL（metadataBase 同款域名）。
// ============================================================

export interface Crumb {
  label: string
  href?: string
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  const base = BRAND_SITE.url
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: `${base}${c.href}` } : {}),
    })),
  }

  return (
    <div className="wrap">
      <nav aria-label="面包屑" className="crumb">
        {items.map((c, i) => (
          <span key={c.label}>
            {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
            {i < items.length - 1 && <span aria-hidden="true">/</span>}
          </span>
        ))}
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  )
}
