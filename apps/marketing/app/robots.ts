import { MetadataRoute } from 'next'
import { OFFICIAL_SITE } from '@/lib/constants'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/'
    },
    sitemap: `${OFFICIAL_SITE.url.replace(/\/$/, '')}/sitemap.xml`
  }
}
