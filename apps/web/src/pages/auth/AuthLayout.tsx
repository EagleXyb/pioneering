/**
 * 认证页面共享布局 — 严格对齐原型 docs/login-app/index.html
 *
 * 结构与原型 DOM 一一对应：
 *   .pageContainer（原型 .page）
 *     ├─ 背景层               原型 .page__bg + .page__scrim
 *     │    ├─ SpaceBackdrop   深色：整页全幅太空（银河照片 + 全屏星空 + 遮罩）
 *     │    └─ ParticleGalaxy  浅色：WebGL2 粒子星云
 *     ├─ header.topBar           原型 .topbar（移动端紧凑品牌 / 合规标识 / 导航 / 语言切换 / 主题切换）
 *     ├─ main.stage              原型 .layout（52.1fr / 47.9fr）
 *     │    ├─ section.hero       原型 .brand（标识 + 运行态 + 主张 + 能力标签）
 *     │    └─ section.formPanel  原型 .formpane → .authCard（原型 .card）
 *     └─ footer.footBar          原型 .footbar（移动端引导 / 版权 + 备案 / 证书）
 *
 * 主题：跟随全局 ThemeProvider（store/themeContext）——登录页不再自建主题体系，
 *      顶栏的主题切换按钮直接调用 setTheme，与登录后工作台保持一致（决策 2）。
 *
 * 图标：品牌标识、合规、能力、证书图标均为原型内联 SVG 转录，见 ./authIcons。
 */
import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTheme } from '../../store/themeContext';
import ParticleGalaxy from '../../components/particle-galaxy/ParticleGalaxy';
import SpaceBackdrop from '../../components/space-backdrop/SpaceBackdrop';
import {
  BrandMarkLg,
  BrandMarkSm,
  CapAudit,
  CapDeploy,
  CapOrchestration,
  CertGlobe,
  CertLock,
  CertShield,
  ComplianceShield,
  MoonIcon,
  SunIcon,
} from './authIcons';
import styles from './auth.module.css';

interface AuthLayoutProps {
  /** 卡片内表单内容 */
  children: ReactNode;
  /** 卡片标题（如 "登录工作台" / "创建账号"） */
  welcomeTitle: string;
  /** 卡片副标题（英文） */
  welcomeSubtitle: string;
  /**
   * 是否在移动端底部合规区展示「还没有企业账号？申请开通」引导。
   * 仅登录页需要（原型画布帧 2:190 移动端底栏；桌面卡片内引导已下线）。
   */
  showEnroll?: boolean;
}

export default function AuthLayout({
  children,
  welcomeTitle,
  welcomeSubtitle,
  showEnroll = false,
}: AuthLayoutProps) {
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const goRegister = () => navigate('/auth/register');

  return (
    <div className={styles.pageContainer}>
      {/* 背景层：深色 = 整页全幅太空（SpaceBackdrop：银河照片 + 全屏星空 + 遮罩）；
          浅色 = 粒子星云（WebGL2，见 components/particle-galaxy）。
          两套定位各自独立（照片需全幅连续，星云则出血到左下角外沿）。 */}
      {isDark ? (
        <SpaceBackdrop />
      ) : (
        <ParticleGalaxy
          className={styles.galaxyLayer}
          /* 浅色页面没有"深空"语境：关泛光、走 normal 混合、不生成背景星 */
          palette="light"
          composite="source-over"
          arms={3}
          count={45000}
          tilt={0.62}
          camElev={42}
          glow={0.5}
          dpr={3}
        />
      )}

      {/* ============================ 顶栏（原型 .topbar） ============================ */}
      <header className={styles.topBar}>
        {/* 移动端紧凑品牌（<768 显示） */}
        <div className={styles.topBrand}>
          <span className={styles.topMarkSm}>
            <BrandMarkSm />
          </span>
          <span className={styles.topBrandNaming}>
            <span className={styles.topBrandName}>创新创造智能体</span>
            <span className={styles.topBrandNameEn}>NOVA AGENT</span>
          </span>
        </div>

        <p className={styles.topCompliance}>
          <ComplianceShield />
          已通过等保三级 · ISO 27001 认证
        </p>

        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.topLink}
            onClick={() => toast.info('帮助中心即将上线')}
          >
            帮助中心
          </button>
          <button
            type="button"
            className={`${styles.topLink} ${styles.topLinkMuted}`}
            onClick={() => toast.info('开发者文档即将上线')}
          >
            开发者文档<span>Docs</span>
          </button>
          <span className={styles.topDivider} aria-hidden="true" />

          <div className={styles.langSwitch} role="group" aria-label="语言切换">
            <button type="button" className={styles.langBtnActive} aria-pressed="true">
              简中
            </button>
            <button
              type="button"
              className={styles.langBtn}
              aria-pressed="false"
              onClick={() => toast.info('English UI 即将支持')}
            >
              EN
            </button>
          </div>

          <button
            type="button"
            className={styles.themeToggle}
            aria-label={isDark ? '切换到浅色主题' : '切换到深色主题'}
            aria-pressed={isDark}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      </header>

      {/* ============================ 主体（原型 .layout） ============================ */}
      <main className={styles.stage}>
        {/* ------------------------ 品牌区（原型 .brand） ------------------------ */}
        <section className={styles.hero} aria-label="品牌信息">
          {/* 深色主题下 .heroCard 升级为全透明玻璃卡，包裹品牌内容 */}
          <div className={styles.heroCard}>
            <div className={styles.brandLogo}>
              <span className={styles.brandMark}>
                <BrandMarkLg />
              </span>
              <span className={styles.brandNaming}>
                <span className={styles.brandName}>创新创造智能体</span>
                <span className={styles.brandNameEn}>NOVA · CREATIVE AGENT PLATFORM</span>
              </span>
            </div>

            <p className={styles.brandTag}>
              <span className={styles.brandDot} aria-hidden="true" />
              Agent Runtime · 已就绪
            </p>

            <div className={styles.brandHeadline}>
              <h1 className={styles.brandTitle}>
                让每一次创新创造，
                <br />
                都有智能体在场
              </h1>
              <p className={styles.brandClaim}>
                An agent-native workspace for enterprise invention — secure, governed, always on.
              </p>
            </div>

            <ul className={styles.brandCaps}>
              <li className={styles.cap}>
                <CapOrchestration />
                多智能体编排
              </li>
              <li className={styles.cap}>
                <CapAudit />
                全链路审计
              </li>
              <li className={styles.cap}>
                <CapDeploy />
                私有化部署
              </li>
            </ul>
          </div>
        </section>

        {/* ------------------------ 表单区（原型 .formpane） ------------------------ */}
        <section className={styles.formPanel} aria-label="登录表单">
          <div className={styles.authCard}>
            <div className={styles.welcomeHeader}>
              <div className={styles.welcomeTitle}>{welcomeTitle}</div>
              <div className={styles.welcomeSubtitle}>{welcomeSubtitle}</div>
            </div>

            {children}
          </div>
        </section>
      </main>

      {/* ============================ 底部合规区（原型 .footbar） ============================ */}
      <footer className={styles.footBar}>
        {/* 未注册引导（桌面位于卡片内，移动端收敛至此） */}
        {showEnroll && (
          <p className={styles.footEnroll}>
            还没有企业账号？
            <button type="button" className={styles.footEnrollLink} onClick={goRegister}>
              申请开通
            </button>
          </p>
        )}

        <div className={styles.footLegal}>
          <p className={styles.footCopy}>© 2026 创新创造智能体 NOVA · 保留所有权利</p>
          <p className={styles.footIcp}>
            粤ICP备 2026000000 号-1 · 粤公网安备 44030002000000 号 · 增值电信业务经营许可证
            B2B-2000NOVAA
          </p>
        </div>

        <div className={styles.footCerts}>
          <span className={styles.cert}>
            <CertShield />
            等保三级
          </span>
          <span className={styles.cert}>
            <CertGlobe />
            ISO 27001
          </span>
          <span className={styles.cert}>
            <CertLock />
            国密 SM2
          </span>
        </div>
      </footer>
    </div>
  );
}
