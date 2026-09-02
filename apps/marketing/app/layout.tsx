import type { Metadata } from 'next'
import { Inter, Noto_Sans_SC } from 'next/font/google'
import { OFFICIAL_SITE } from '@/lib/constants'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-sc',
  display: 'swap',
})

// 默认 metadata = 官网首页（/），趋势报告（/trends）由自身 metadata 覆盖。
export const metadata: Metadata = {
  metadataBase: new URL(OFFICIAL_SITE.url),
  title: {
    default: OFFICIAL_SITE.title,
    template: '%s · Pioneering'
  },
  description: OFFICIAL_SITE.description,
  openGraph: {
    title: OFFICIAL_SITE.ogTitle,
    description: OFFICIAL_SITE.ogDescription,
    type: 'website',
    locale: OFFICIAL_SITE.locale,
    siteName: OFFICIAL_SITE.name
  },
  twitter: {
    card: 'summary_large_image',
    title: OFFICIAL_SITE.ogTitle,
    description: OFFICIAL_SITE.ogDescription
  },
  alternates: {
    canonical: '/'
  }
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${notoSansSC.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
