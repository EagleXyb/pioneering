import { MetadataRoute } from 'next'
import { OFFICIAL_SITE, SITE } from '@/lib/constants'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = OFFICIAL_SITE.url.replace(/\/$/, '')
  const trends = SITE.url.replace(/\/$/, '')
  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    },
    {
      url: `${base}/trends`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9
    },
    {
      url: `${trends}/trends`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8
    }
  ]
}
