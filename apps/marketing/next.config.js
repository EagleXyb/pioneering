/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 安全/性能：移除 X-Powered-By 响应头
  poweredByHeader: false,
};

module.exports = nextConfig;
