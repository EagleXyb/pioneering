import Link from 'next/link'

// ============================================================
// Breadcrumb · 内页面包屑 + BreadcrumbList JSON-LD（IA 6.2 要求）
// ============================================================

export interface Crumb {
  label: string
  href?: string
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: c.href } : {}),
    })),
  }

  return (
    <div className="wrap">
      <div className="crumb">
        {items.map((c, i) => (
          <span key={c.label}>
            {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
            {i < items.length - 1 && <span>/</span>}
          </span>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  )
}
