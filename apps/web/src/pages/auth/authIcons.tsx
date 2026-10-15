/**
 * 认证页内联 SVG 图标集
 *
 * 来源：docs/login-app/index.html 中的内联 SVG，逐节点转录（viewBox / path / 描边宽度保持不变）。
 * 颜色通过 CSS 变量传入，随明暗主题自动切换，与 docs/login-app/styles/tokens.css 的
 * --ic-stroke* / --ac-logo-glyph 一一对应。
 *
 * 注意：这些图标刻意不使用 lucide-react —— 原型中的品牌标识与能力/证书图标是定制图形，
 * 需保持与设计稿一致的轮廓比例。
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** 品牌标识（大号，品牌区用，28×28；对应原型 .brand__logo 内联 SVG） */
export function BrandMarkLg({ className, ...rest }: IconProps) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path
        d="M14 3.2L24.2 8.9V19.1L14 24.8L3.8 19.1V8.9L14 3.2Z"
        stroke="var(--nova-logo-glyph)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="14" r="3.4" fill="var(--nova-logo-glyph)" />
      <path
        d="M14 3.2V10.6M24.2 8.9L17.2 12.3M24.2 19.1L17.2 15.7M14 24.8V17.4M3.8 19.1L10.8 15.7M3.8 8.9L10.8 12.3"
        stroke="var(--nova-icon-logo)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 品牌标识（紧凑，移动端顶栏用，18×18；对应原型 .topbar__brand 内联 SVG） */
export function BrandMarkSm({ className, ...rest }: IconProps) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path
        d="M14 3.2L24.2 8.9V19.1L14 24.8L3.8 19.1V8.9L14 3.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="14" r="3.2" fill="currentColor" />
    </svg>
  );
}

/** 顶栏合规认证标识（14×16） */
export function ComplianceShield({ className, ...rest }: IconProps) {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      fill="none"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path
        d="M7 1L1.5 3.4V7.6C1.5 11.2 3.9 14.2 7 15C10.1 14.2 12.5 11.2 12.5 7.6V3.4L7 1Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M4.7 7.7L6.4 9.4L9.4 6.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 能力标签：多智能体编排（15×15） */
export function CapOrchestration({ className, ...rest }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className} {...rest}>
      <circle cx="4" cy="7.5" r="2.1" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="11" cy="7.5" r="2.1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6.1 7.5H8.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** 能力标签：全链路审计（15×15） */
export function CapAudit({ className, ...rest }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M7.5 1.8L13 4.6V10.4L7.5 13.2L2 10.4V4.6L7.5 1.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M5.3 7.5L6.9 9.1L9.7 6.3"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 能力标签：私有化部署（15×15） */
export function CapDeploy({ className, ...rest }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className} {...rest}>
      <rect x="2.4" y="6.6" width="10.2" height="6.6" rx="1.6" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5.1 6.6V5.1C5.1 4.1 5.9 3.3 6.9 3.3H8.1C9.1 3.3 9.9 4.1 9.9 5.1V6.6"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 底部证书：等保三级（14×14） */
export function CertShield({ className, ...rest }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M7 1.2L12.2 3.4V7C12.2 10.2 10 12.9 7 13.6C4 12.9 1.8 10.2 1.8 7V3.4L7 1.2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 底部证书：ISO 27001（14×14） */
export function CertGlobe({ className, ...rest }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className} {...rest}>
      <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M1.4 7H12.6M7 1.4C8.7 3.4 9.5 5.1 9.5 7C9.5 8.9 8.7 10.6 7 12.6C5.3 10.6 4.5 8.9 4.5 7C4.5 5.1 5.3 3.4 7 1.4Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

/** 底部证书：国密 SM2（14×14） */
export function CertLock({ className, ...rest }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className} {...rest}>
      <rect x="2.4" y="6.2" width="9.2" height="5.8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M4.6 6.2V4.8C4.6 3.8 5.4 3 6.4 3H7.6C8.6 3 9.4 3.8 9.4 4.8V6.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 表单字段：用户名 / 邮箱（17×17）。SVG 颜色由 CSS 的 color 决定 */
export function FieldAccountIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true" className={className} {...rest}>
      <circle cx="8.5" cy="5.6" r="2.9" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M2.9 14.4C2.9 11.5 5.5 9.8 8.5 9.8C11.5 9.8 14.1 11.5 14.1 14.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 表单字段：密码（17×17） */
export function FieldLockIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true" className={className} {...rest}>
      <rect x="3" y="7.1" width="11" height="7.4" rx="1.7" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M5.7 7.1V5.4C5.7 4.2 6.6 3.3 7.8 3.3H9.2C10.4 3.3 11.3 4.2 11.3 5.4V7.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 密码显隐：睁眼（18×18） */
export function EyeOnIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M1.9 9C3.6 5.9 6.1 4.4 9 4.4C11.9 4.4 14.4 5.9 16.1 9C14.4 12.1 11.9 13.6 9 13.6C6.1 13.6 3.6 12.1 1.9 9Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** 密码显隐：闭眼（18×18） */
export function EyeOffIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M1.9 9C3.6 5.9 6.1 4.4 9 4.4C11.9 4.4 14.4 5.9 16.1 9C14.4 12.1 11.9 13.6 9 13.6C6.1 13.6 3.6 12.1 1.9 9Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M2.6 15.4L15.4 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 表单级错误横幅警示图标（14×14） */
export function AlertIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className} {...rest}>
      <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 3.6V7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7" cy="9.9" r="0.7" fill="currentColor" />
    </svg>
  );
}

/** 主按钮箭头（16×16） */
export function SubmitArrow({ className, ...rest }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M2.6 8H13.2M9.2 4.2L13.2 8L9.2 11.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 主按钮加载指示（17×17，配合 spin 动画） */
export function SubmitSpinner({ className, ...rest }: IconProps) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true" className={className} {...rest}>
      <circle cx="8.5" cy="8.5" r="6.2" stroke="#FFFFFF" strokeWidth="1.9" />
      <path d="M14.7 8.5C14.7 12.18 11.68 15.2 8 15.2" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** 记住登录勾选标记（10×10） */
export function CheckMark({ className, ...rest }: IconProps) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M1.7 5.2L3.9 7.4L8.3 2.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 安全加密提示锁（15×15） */
export function TrustLock({ className, ...rest }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className={className} {...rest}>
      <rect x="2.6" y="6.4" width="9.8" height="6.4" rx="1.6" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M5 6.4V4.9C5 3.9 5.8 3.1 6.8 3.1H8.2C9.2 3.1 10 3.9 10 4.9V6.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 辅助登录：企业 SSO（16×16） */
export function SsoIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className} {...rest}>
      <path d="M8 1.6L13.6 4.5V8.9L8 11.8L2.4 8.9V4.5L8 1.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="8" cy="6.7" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 10C5.2 8.7 6.4 7.9 8 7.9C9.6 7.9 10.8 8.7 10.8 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 辅助登录：验证码登录（16×16） */
export function OtpIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className} {...rest}>
      <rect x="2.6" y="3.2" width="10.8" height="9.6" rx="1.7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.6 6.4H13.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.4 1.9V4M10.6 1.9V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.6 9.4L7 10.8L10.4 7.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 主题切换：月亮（深色态显示，对应原型 .icon-moon） */
export function MoonIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...rest}>
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 主题切换：太阳（浅色态显示，对应原型 .icon-sun） */
export function SunIcon({ className, ...rest }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className} {...rest}>
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
