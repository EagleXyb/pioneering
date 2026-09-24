import { MetadataRoute } from 'next'
import { BRAND_SITE } from '@/data/site/site'

// ============================================================
// sitemap —— 认知品牌站 6 个一级路由 + 保留的 /trends 子站
// ============================================================

const base = BRAND_SITE.url.replace(/\/$/, '')

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${base}/`, priority: 1.0, changeFrequency: 'weekly' },
    { url: `${base}/cognition`, priority: 0.9, changeFrequency: 'monthly' },
    { url: `${base}/insights`, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/agent`, priority: 0.9, changeFrequency: 'monthly' },
    { url: `${base}/cases`, priority: 0.8, changeFrequency: 'monthly' },
    { url: `${base}/about`, priority: 0.6, changeFrequency: 'monthly' },
    { url: `${base}/trends`, priority: 0.4, changeFrequency: 'monthly', lastModified: now },
  ]
}
