import type { Metadata } from 'next'
import { Inter, Noto_Sans_SC } from 'next/font/google'
import { SITE } from '@/lib/constants'
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: SITE.title,
  description: SITE.description,
  openGraph: {
    title: SITE.ogTitle,
    description: SITE.ogDescription,
    type: 'website',
    locale: SITE.locale,
    siteName: SITE.name,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE.ogTitle,
    description: SITE.ogDescription,
  },
  alternates: {
    canonical: '/',
  },
}

export default function RootLayout({
  children,
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
