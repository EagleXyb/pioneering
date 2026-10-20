/**
 * 插件 · 技能 —— 应用市场页（中间栏主区域）
 *
 * 版式参照设计稿：
 *   顶部：页签（插件 / 技能 / 工作伙伴）+ 右侧 搜索 / 管理 / 添加
 *   次行：分类筛选条（全部 / 办公 / 金融 / …）
 *   主体：卡片网格（图标 + 名称 + 简介 + 使用量 + 操作按钮）
 *
 * 数据来源：
 *   - 插件：GET /mcp/servers（已接入的真实插件）+ 内置精选目录（静态候选）
 *   - 技能：GET /skills（服务端已注册/已发现的技能）
 *   - 工作伙伴：尚未上线，占位
 */
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import {
  Boxes,
  Building2,
  Check,
  Clapperboard,
  Cloud,
  CloudSun,
  CreditCard,
  Database,
  FileText,
  Github,
  GraduationCap,
  Landmark,
  LineChart,
  MapPin,
  Megaphone,
  MessageCircle,
  Music,
  NotebookPen,
  PenLine,
  Plane,
  Plus,
  Puzzle,
  Scale,
  Search,
  Slack,
  Sparkles,
  Stethoscope,
  Store,
  Users,
  Video,
  Wallet,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AddPluginDialog } from '@/components/CapabilityBar/AddPluginDialog';
import { NavButtons } from '@/layout/Sidebar/NavButtons';
import { useMcpPlugins } from '@/hooks/useMcpPlugins';
import { useSkillOptions } from '@/hooks/useSkillOptions';
import { useSettingsDialogStore } from '@/store/settingsDialogStore';
import type { McpServerStatus } from '@/api/mcp';
import {
  CATEGORIES,
  CATALOG,
  findCatalogItem,
  type CategoryId,
  type InstallTemplate,
} from './catalog';
import './plugins.css';

type TabKey = 'plugin' | 'skill' | 'partner';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'plugin', label: '插件' },
  { key: 'skill', label: '技能' },
  { key: 'partner', label: '工作伙伴' },
];

/** 分类 chip 之外的兜底图标（未收录的应用统一用 Puzzle） */
const APP_ICONS: Record<string, LucideIcon> = {
  feishu: Plane,
  wecom: MessageCircle,
  dingtalk: Building2,
  'tencent-meeting': Video,
  notion: NotebookPen,
  slack: Slack,
  gdrive: Cloud,
  eastmoney: LineChart,
  wind: Landmark,
  'wechat-pay': Wallet,
  alipay: CreditCard,
  midjourney: Wand2,
  suno: Music,
  runway: Clapperboard,
  xiaohongshu: PenLine,
  'wechat-mp': FileText,
  douyin: Video,
  hubspot: Megaphone,
  taobao: Store,
  jd: Store,
  'dingtalk-workflow': Boxes,
  jira: Boxes,
  'notion-calendar': Zap,
  trello: Boxes,
  bigquery: Database,
  metabase: LineChart,
  'medical-record': Stethoscope,
  fadao: Scale,
  'tax-assistant': Wallet,
  map: MapPin,
  weather: CloudSun,
  arxiv: GraduationCap,
  zotero: GraduationCap,
  github: Github,
  gitlab: Github,
  jenkins: Zap,
  'law-database': Scale,
  'sec-filings': FileText,
};

/** 插件卡片数据（已接入的 MCP Server 与目录候选合并后的统一模型） */
interface PluginCard {
  key: string;
  name: string;
  description: string;
  /** 卡片底部左侧文案（使用量 / 连接状态） */
  foot: string;
  color: string;
  icon: LucideIcon;
  /** 分类；null 表示未收录分类，仅在「全部」下出现 */
  category: CategoryId | null;
  /** 已接入的 MCP Server（真实数据） */
  server?: McpServerStatus;
  /** 目录候选的安装模板 */
  install?: InstallTemplate;
  /** 无官方服务，按钮置灰 */
  unavailable: boolean;
}

/** 技能卡片数据 */
interface SkillCard {
  key: string;
  name: string;
  description: string;
  foot: string;
  category: CategoryId | null;
  tags: string[];
  toolCount: number;
  active: boolean;
}

/** 技能按标签匹配分类（标签与分类名一致时归类），未匹配则为 null */
function skillCategory(tags: string[]): CategoryId | null {
  const hit = CATEGORIES.find(
    (c) =>
      c.id !== 'all' &&
      tags.some((t) => t.trim().toLowerCase() === c.label.toLowerCase()),
  );
  return hit ? (hit.id as CategoryId) : null;
}

export default function PluginsPage() {
  const [tab, setTab] = useState<TabKey>('plugin');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  /** 打开「添加插件」时的预填值（state 持有，引用稳定） */
  const [addPrefill, setAddPrefill] = useState<
    | {
        name: string;
        transport: InstallTemplate['transport'];
        command?: string;
        args?: string[];
        url?: string;
      }
    | null
  >(null);
  const [addEnvHints, setAddEnvHints] = useState<ReadonlyArray<string>>([]);

  const {
    plugins,
    loading: pluginsLoading,
    error: pluginsError,
    busyName,
    refresh,
    togglePlugin,
    addPlugin,
  } = useMcpPlugins();
  const {
    skills,
    loading: skillsLoading,
    error: skillsError,
    isSelected,
    toggleSkill,
    reload,
  } = useSkillOptions('chat');
  const openSettings = useSettingsDialogStore((s) => s.openSettings);

  const installedKeys = useMemo(
    () => new Set(plugins.map((p) => p.name.toLowerCase())),
    [plugins],
  );

  /** 已接入的真实插件 + 目录候选 */
  const pluginCards = useMemo<PluginCard[]>(() => {
    const installed: PluginCard[] = plugins.map((p) => {
      const meta = findCatalogItem(p.name);
      return {
        key: `mcp:${p.name}`,
        name: p.name,
        description:
          meta?.description ?? `${p.transport} 接入的 MCP Server，提供 ${p.toolCount} 个工具`,
        foot: p.connected
          ? `已连接 · ${p.toolCount} 个工具`
          : `未连接 · ${p.toolCount} 个工具`,
        color: meta?.color ?? '#3b82f6',
        icon: APP_ICONS[meta?.id ?? ''] ?? Puzzle,
        category: meta?.category ?? null,
        server: p,
        unavailable: false,
      };
    });

    const catalog: PluginCard[] = CATALOG.filter(
      (c) =>
        !installedKeys.has(c.id.toLowerCase()) &&
        !installedKeys.has(c.name.toLowerCase()),
    ).map((c) => ({
      key: `cat:${c.id}`,
      name: c.name,
      description: c.description,
      foot: c.usage,
      color: c.color,
      icon: APP_ICONS[c.id] ?? Puzzle,
      category: c.category,
      install: c.install,
      unavailable: !c.install,
    }));

    return [...installed, ...catalog];
  }, [plugins, installedKeys]);

  const skillCards = useMemo<SkillCard[]>(
    () =>
      skills.map((s) => ({
        key: `skill:${s.name}`,
        name: s.name,
        description: s.description || '暂无描述',
        foot: s.active
          ? `已加载 · ${s.toolCount} 个工具`
          : `待激活 · ${s.toolCount} 个工具`,
        category: skillCategory(s.tags),
        tags: s.tags,
        toolCount: s.toolCount,
        active: s.active,
      })),
    [skills],
  );

  const q = query.trim().toLowerCase();

  const visiblePlugins = useMemo(
    () =>
      pluginCards.filter((c) => {
        if (category !== 'all' && c.category !== category) return false;
        if (!q) return true;
        return `${c.name} ${c.description}`.toLowerCase().includes(q);
      }),
    [pluginCards, category, q],
  );

  const visibleSkills = useMemo(
    () =>
      skillCards.filter((c) => {
        if (category !== 'all' && c.category !== category) return false;
        if (!q) return true;
        return `${c.name} ${c.description} ${c.tags.join(' ')}`
          .toLowerCase()
          .includes(q);
      }),
    [skillCards, category, q],
  );

  const searchPlaceholder =
    tab === 'plugin'
      ? '搜索插件'
      : tab === 'skill'
        ? '搜索技能'
        : '搜索工作伙伴';

  const sectionTitle =
    tab === 'plugin'
      ? '大家都在用'
      : tab === 'skill'
        ? '全部技能'
        : '工作伙伴';

  /** 切换页签：清空搜索并回到「全部」分类 */
  const handleTabChange = useCallback((key: TabKey) => {
    setTab(key);
    setQuery('');
    setCategory('all');
  }, []);

  /** 「添加」：插件页打开添加对话框；其余页签给出说明 */
  const handleAdd = useCallback(() => {
    if (tab !== 'plugin') {
      toast.info(
        tab === 'skill'
          ? '技能由服务端自动发现，暂不支持手动添加'
          : '工作伙伴正在建设中',
      );
      return;
    }
    setAddPrefill(null);
    setAddEnvHints([]);
    setAddOpen(true);
  }, [tab]);

  /** 「管理」：跳转到设置框对应分区 */
  const handleManage = useCallback(() => {
    openSettings(tab === 'plugin' ? 'mcp' : 'general');
  }, [openSettings, tab]);

  /** 目录项「安装」：用官方 MCP 模板预填添加对话框 */
  const handleInstall = useCallback((card: PluginCard) => {
    if (!card.install) {
      toast.info('该应用的官方服务尚未上线，敬请期待');
      return;
    }
    const meta = CATALOG.find((c) => `cat:${c.id}` === card.key);
    setAddPrefill({
      name: meta?.id ?? card.name.toLowerCase(),
      transport: card.install.transport,
      command: card.install.command,
      args: card.install.args,
      url: card.install.url,
    });
    setAddEnvHints(card.install.envHints ?? []);
    setAddOpen(true);
  }, []);

  /** 已接入插件的启用 / 停用 */
  const handleToggle = useCallback(
    async (server: McpServerStatus) => {
      const res = await togglePlugin(server);
      if (res.ok) toast.success(res.message);
      else toast.error(`操作失败：${res.message}`);
    },
    [togglePlugin],
  );

  const renderPluginCard = (card: PluginCard) => {
    const Icon = card.icon;
    const busy = card.server ? busyName === card.server.name : false;

    let action;
    if (card.server) {
      const connected = card.server.connected;
      action = (
        <button
          type="button"
          className={`plugins-card__btn${connected ? ' is-on' : ''}`}
          onClick={() => void handleToggle(card.server as McpServerStatus)}
          disabled={busy}
        >
          {busy ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : connected ? (
            <>
              <Check size={13} />
              已连接
            </>
          ) : (
            '启用'
          )}
        </button>
      );
    } else if (card.unavailable) {
      action = (
        <button type="button" className="plugins-card__btn" disabled>
          即将上线
        </button>
      );
    } else {
      action = (
        <button
          type="button"
          className="plugins-card__btn"
          onClick={() => handleInstall(card)}
        >
          安装
        </button>
      );
    }

    return (
      <article key={card.key} className="plugins-card">
        <div
          className="plugins-card__icon"
          style={{ '--icon-color': card.color } as CSSProperties}
          aria-hidden="true"
        >
          <Icon size={22} strokeWidth={1.75} />
        </div>
        <div className="plugins-card__main">
          <h3 className="plugins-card__name">{card.name}</h3>
          <p className="plugins-card__desc">{card.description}</p>
          <div className="plugins-card__foot">
            <span className="plugins-card__usage">{card.foot}</span>
            {action}
          </div>
        </div>
      </article>
    );
  };

  const renderSkillCard = (card: SkillCard) => {
    const selected = isSelected(card.name);
    return (
      <article key={card.key} className="plugins-card">
        <div
          className="plugins-card__icon"
          style={{ '--icon-color': '#8b5cf6' } as CSSProperties}
          aria-hidden="true"
        >
          <Sparkles size={22} strokeWidth={1.75} />
        </div>
        <div className="plugins-card__main">
          <h3 className="plugins-card__name">{card.name}</h3>
          <p className="plugins-card__desc">{card.description}</p>
          <div className="plugins-card__foot">
            <span className="plugins-card__usage">{card.foot}</span>
            <button
              type="button"
              className={`plugins-card__btn${selected ? ' is-on' : ''}`}
              onClick={() => toggleSkill(card.name)}
              aria-pressed={selected}
            >
              {selected ? (
                <>
                  <Check size={13} />
                  已使用
                </>
              ) : (
                '使用'
              )}
            </button>
          </div>
        </div>
      </article>
    );
  };

  const loading =
    tab === 'plugin' ? pluginsLoading : tab === 'skill' ? skillsLoading : false;
  const error =
    tab === 'plugin' ? pluginsError : tab === 'skill' ? skillsError : null;
  const isEmpty =
    tab === 'plugin'
      ? visiblePlugins.length === 0
      : tab === 'skill'
        ? visibleSkills.length === 0
        : true;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="plugins-page">
        {/* 顶部：页签 + 搜索 / 管理 / 添加 */}
        <header className="plugins-header">
          <div className="plugins-header__left">
            {/* 侧边栏折叠/展开入口（该路由不渲染全局 TopNav，故此处自带） */}
            <NavButtons />
            <div className="plugins-tabs" role="tablist" aria-label="插件与技能">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`plugins-tab${tab === t.key ? ' is-active' : ''}`}
                  onClick={() => handleTabChange(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="plugins-header__actions">
            <div className="plugins-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
            <button
              type="button"
              className="plugins-action"
              onClick={handleManage}
            >
              管理
            </button>
            <button
              type="button"
              className="plugins-action plugins-action--primary"
              onClick={handleAdd}
            >
              <Plus size={14} />
              添加
            </button>
          </div>
        </header>

        <div className="plugins-body">
          {/* 分类筛选条 */}
          <nav className="plugins-categories" aria-label="分类筛选">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`plugins-chip${category === c.id ? ' is-active' : ''}`}
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
              >
                {c.label}
              </button>
            ))}
          </nav>

          <section className="plugins-section">
            <h2 className="plugins-section__title">{sectionTitle}</h2>

            {loading && (
              <div className="plugins-state">
                <Spinner className="h-5 w-5" />
                <span>加载中…</span>
              </div>
            )}

            {!loading && error && (
              <div className="plugins-state plugins-state--error">
                <span>{error}</span>
                <button
                  type="button"
                  className="plugins-state__retry"
                  onClick={() => {
                    if (tab === 'plugin') void refresh();
                    else reload();
                  }}
                >
                  重试
                </button>
              </div>
            )}

            {!loading && !error && tab === 'partner' && (
              <div className="plugins-state plugins-state--empty">
                <Users size={32} strokeWidth={1.5} />
                <p>工作伙伴正在建设中，敬请期待</p>
              </div>
            )}

            {!loading &&
              !error &&
              tab !== 'partner' &&
              isEmpty && (
                <div className="plugins-state plugins-state--empty">
                  <Puzzle size={32} strokeWidth={1.5} />
                  <p>
                    {q
                      ? '未找到匹配的内容'
                      : tab === 'plugin'
                        ? '暂无插件，点击右上角「添加」接入 MCP Server'
                        : '暂无技能，请在服务端配置 skills.auto_discover_dirs'}
                  </p>
                </div>
              )}

            {!loading && !error && tab === 'plugin' && (
              <div className="plugins-grid">
                {visiblePlugins.map(renderPluginCard)}
              </div>
            )}

            {!loading && !error && tab === 'skill' && (
              <div className="plugins-grid">
                {visibleSkills.map(renderSkillCard)}
              </div>
            )}
          </section>
        </div>

        {/* 添加插件：目录项安装时预填官方接入模板 */}
        <AddPluginDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSubmit={addPlugin}
          initialValues={addPrefill ?? undefined}
          envHints={addEnvHints}
        />
      </div>
    </TooltipProvider>
  );
}
