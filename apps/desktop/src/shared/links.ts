// ============================================================
// external-links — 外部链接常量（单一来源，主/渲染端共用）
//
// 为什么集中：
//   - 设置页 / 菜单 / 侧边栏多处会用到官网、文档、邮箱等链接；
//     散落硬编码容易出现「同一链接改三处忘一处」的同步灾难。
//   - 与 marketing 站 (apps/marketing/lib/constants.ts) 的 OFFICIAL_SITE 对齐，
//     后续若官网域名迁移，只改本文件一处即可。
//
// 使用：
//   - 渲染端 import from '@shared/links'（参见 tsconfig.web.json paths）
//   - 主进程 import from '../shared/links'（被 tsconfig.node.json include 覆盖）
//
// 注意：
//   - URL 一律以 https:// / mailto: 开头，不要在本文件中塞动态逻辑；
//     需要拼接时由调用点负责。
// ============================================================

/**
 * Pioneering 官方网站（marketing 应用承载）。
 *
 * 与 `apps/marketing/lib/constants.ts` 中 `OFFICIAL_SITE.url` 保持一致；
 * 如果未来 marketing 站点迁移到新域名，只需修改本常量即可。
 */
export const OFFICIAL_SITE_URL = 'https://pioneering.ai'

/** 趋势报告子页（在官网根域下） */
export const TRENDS_REPORT_URL = `${OFFICIAL_SITE_URL}/trends`

/** 桌面端分发入口（CTA 按钮指向） */
export const DESKTOP_DOWNLOAD_URL = `${OFFICIAL_SITE_URL}/desktop`

/** 文档中心 */
export const DOCS_URL = 'https://docs.pioneering.ai'

/** GitHub Issue 反馈入口 */
export const FEEDBACK_URL = 'https://github.com/pioneering/feedback'

/** 客服邮箱 */
export const SUPPORT_EMAIL = 'support@pioneering.ai'

/** mailto: 形式的完整链接，方便直接传 shellApi.openExternal */
export const SUPPORT_MAILTO_URL = `mailto:${SUPPORT_EMAIL}`
