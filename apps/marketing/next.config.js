/** @type {import('next').NextConfig} */
const securityHeaders = [
  // 阻止浏览器猜测响应类型（防 MIME 嗅探）
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 页面仅允许被同源框架嵌入（防点击劫持；品牌站无 iframe 嵌入需求）
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Referer 跨域仅发送 origin，避免完整路径泄漏
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 强制 HTTPS（2 年 + 子域）；首次确认全站 HTTPS 后保持开启
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  // 禁用未授予权限的能力 API
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
]

const nextConfig = {
  reactStrictMode: true,
  // 安全/性能：移除 X-Powered-By 响应头
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
