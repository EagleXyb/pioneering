/**
 * 认证页面共享布局 — 对齐原型 V1.3
 * 左侧品牌面板 + 右侧表单面板
 */
import type { ReactNode } from 'react';
import styles from './auth.module.css';

interface AuthLayoutProps {
  /** 右侧表单区域内容 */
  children: ReactNode;
  /** 欢迎标题（如 "欢迎回来" / "创建账号"） */
  welcomeTitle: string;
  /** 欢迎副标题 */
  welcomeSubtitle: string;
}

export default function AuthLayout({ children, welcomeTitle, welcomeSubtitle }: AuthLayoutProps) {
  return (
    <div className={styles.pageContainer}>
      {/* 左侧品牌面板 */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          <div className={styles.logoRow}>
            <div className={styles.logoIcon}>C</div>
            <div className={styles.brandName}>CloudHub</div>
          </div>
          <div className={styles.mainTitle}>构建未来的数字</div>
          <div className={styles.highlightTitle}>智能云基础设施</div>
          <div className={styles.subtitle}>
            一站式云端管理平台，让您的业务高效运行，安全可靠。
          </div>
        </div>

        {/* 3D 立方体装饰 */}
        <div className={styles.decorContainer}>
          <div className={styles.cubeTop} />
          <div className={styles.cubeRight} />
          <div className={styles.cubeLeft} />
          <div className={styles.circle1} />
          <div className={styles.circle2} />
          <div className={styles.circle3} />
        </div>
      </div>

      {/* 右侧表单面板 */}
      <div className={styles.formPanel}>
        <div className={styles.authCard}>
          {/* 欢迎头部 */}
          <div className={styles.welcomeHeader}>
            <div className={styles.welcomeTitle}>{welcomeTitle}</div>
            <div className={styles.welcomeSubtitle}>{welcomeSubtitle}</div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}