import { MetadataRoute } from 'next'
import { BRAND_SITE } from '@/data/site/site'

export default function robots(): MetadataRoute.Robots {
  const base = BRAND_SITE.url.replace(/\/$/, '')
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
