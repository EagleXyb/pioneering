import type { Metadata } from 'next'
import { Inter, Noto_Sans_SC, Noto_Serif_SC } from 'next/font/google'
import { BRAND_SITE } from '@/data/site/site'
import { MotionProvider } from '@/components/animations/MotionProvider'
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

// 衬线标题字体（原型：Songti SC / Noto Serif SC，600 为标题字重，400 为引文字重）
const notoSerifSC = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-noto-serif-sc',
  display: 'swap',
})

// 默认 metadata = 认知×创新品牌站（(site) 路由组）；/trends 由自身 metadata 覆盖。
export const metadata: Metadata = {
  metadataBase: new URL(BRAND_SITE.url),
  title: {
    default: `${BRAND_SITE.name}｜${BRAND_SITE.tagline}`,
    template: `%s | ${BRAND_SITE.name}`,
  },
  description:
    '认知×创新品牌站：可追溯的认知方法论、高质量知识专栏、认知陪练智能体与真实应用案例。',
  openGraph: {
    title: `${BRAND_SITE.name}｜认知×创新`,
    description:
      '不替你下判断，让你看清自己是怎么下判断的。方法论、知识专栏、智能体陪练与真实案例。',
    type: 'website',
    locale: BRAND_SITE.locale,
    siteName: BRAND_SITE.name,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND_SITE.name}｜认知×创新`,
    description: '不替你下判断，让你看清自己是怎么下判断的。',
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
      className={`${inter.variable} ${notoSansSC.variable} ${notoSerifSC.variable}`}
    >
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}
