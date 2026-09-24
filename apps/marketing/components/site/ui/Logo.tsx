import Link from 'next/link'
import { BRAND_SITE } from '@/data/site/site'
import { LogoMark } from './Icons'

// ============================================================
// Logo · 导航（深墨蓝描边）/ 页脚（白色描边）两种色调
// ============================================================

export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <Link href="/" className="logo" style={tone === 'light' ? { color: '#fff' } : undefined}>
      <LogoMark tone={tone} />
      <span>{BRAND_SITE.name}</span>
    </Link>
  )
}
