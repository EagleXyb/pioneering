import Link from 'next/link'
import { BRAND_FOOTER, FOOTER_BOTTOM, BRAND_SITE } from '@/data/site/site'
import { Logo } from '@/components/site/ui/Logo'

// ============================================================
// SiteFooter — 深色 5 列页脚（品牌简介 + 四组链接 + 底部信息栏）
// ============================================================

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <Logo tone="light" />
            <p
              className="small mt-3"
              style={{ color: 'rgba(255,255,255,.6)', maxWidth: '22em' }}
            >
              {BRAND_SITE.tagline}
            </p>
          </div>
          {BRAND_FOOTER.map((col) => (
            <div key={col.title}>
              <div className="ft">{col.title}</div>
              <ul>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="foot-bot">
          <div>© 2026 {BRAND_SITE.name}　京ICP备XXXXXXXX号</div>
          <div className="flex gap-3 wrap-f">
            {FOOTER_BOTTOM.map((l) => (
              <a key={l.label} href={l.href}>
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
