/**
 * 插件目录 —— 前端静态元数据（内置精选应用）
 *
 * 说明：后端目前只提供「已接入的 MCP Server」列表（GET /mcp/servers），
 * 没有应用市场接口。本文件提供市场页所需的「可选应用」元数据：
 *   - 分类（与参考图一致：全部 / 办公 / 金融 / 财经支付 / …）
 *   - 图标底色、简介、使用量文案（示意文案，非真实统计）
 *   - install：官方 MCP Server 的接入模板。点击「安装」会用该模板
 *     预填「添加插件」表单（仍需用户补充凭据后提交）；
 *     模板缺省表示官方服务尚未提供，按钮置灰并标注「即将上线」。
 *
 * 已接入的 MCP Server 不在此目录内，页面会把它们与目录项合并展示，
 * 保证真实数据一定可见（目录只是「可安装候选」的补充）。
 */
import type { McpTransport } from '@/api/mcp';

export type CategoryId =
  | 'office'
  | 'finance'
  | 'finance-pay'
  | 'media'
  | 'content'
  | 'marketing'
  | 'ecommerce'
  | 'management'
  | 'efficiency'
  | 'analytics'
  | 'medical'
  | 'legal'
  | 'life'
  | 'research'
  | 'engineering'
  | 'law-research';

export interface Category {
  id: CategoryId | 'all';
  label: string;
}

/** 分类顺序与参考图一致：全部置首 */
export const CATEGORIES: ReadonlyArray<Category> = [
  { id: 'all', label: '全部' },
  { id: 'office', label: '办公' },
  { id: 'finance', label: '金融' },
  { id: 'finance-pay', label: '财经支付' },
  { id: 'media', label: '多媒体创作' },
  { id: 'content', label: '内容创作' },
  { id: 'marketing', label: '营销销售' },
  { id: 'ecommerce', label: '电商' },
  { id: 'management', label: '企业管理' },
  { id: 'efficiency', label: '效率工具' },
  { id: 'analytics', label: '数据分析' },
  { id: 'medical', label: '医疗' },
  { id: 'legal', label: '法律税务' },
  { id: 'life', label: '生活出行' },
  { id: 'research', label: '教研科研' },
  { id: 'engineering', label: '工程' },
  { id: 'law-research', label: '研究法律' },
];

/** 接入模板：用于预填「添加插件」表单 */
export interface InstallTemplate {
  transport: McpTransport;
  /** stdio 启动命令 */
  command?: string;
  /** stdio 命令参数 */
  args?: string[];
  /** 远程服务地址 */
  url?: string;
  /** 需要用户补充的凭据（键名即环境变量名） */
  envHints?: ReadonlyArray<string>;
}

export interface CatalogItem {
  /** 与 MCP Server 名对应（用于判断是否已安装） */
  id: string;
  name: string;
  category: CategoryId;
  /** 一句话简介 */
  description: string;
  /** 使用量文案（示意） */
  usage: string;
  /** 图标底色（浅色块 + 同色系前景） */
  color: string;
  /** 官方接入模板；缺省表示暂无可用官方服务 */
  install?: InstallTemplate;
}

/** 内置精选应用目录 */
export const CATALOG: ReadonlyArray<CatalogItem> = [
  {
    id: 'feishu',
    name: '飞书企业号',
    category: 'office',
    description: '绑定飞书企业号，完成各类工作任务',
    usage: '17.4 万人使用',
    color: '#3370ff',
  },
  {
    id: 'wecom',
    name: '企业微信',
    category: 'office',
    description: '通过企业微信接入会话与审批流程',
    usage: '15.2 万人使用',
    color: '#2f7ef7',
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    category: 'office',
    description: '打通钉钉待办、群聊与机器人通知',
    usage: '14.7 万人使用',
    color: '#2f7ef7',
  },
  {
    id: 'tencent-meeting',
    name: '腾讯会议',
    category: 'office',
    description: '预约和管理会议，查询会议纪要、录制、陪练',
    usage: '9.7 万人使用',
    color: '#0a7cff',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'office',
    description: '读写 Notion 页面与数据库，知识库随问随答',
    usage: '28.6 万人使用',
    color: '#111111',
    install: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      envHints: ['NOTION_TOKEN'],
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'office',
    description: '检索与发送 Slack 消息，团队协作无缝衔接',
    usage: '21.3 万人使用',
    color: '#4a154b',
    install: {
      transport: 'sse',
      url: 'https://mcp.slack.com/sse',
      envHints: ['SLACK_BOT_TOKEN'],
    },
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    category: 'office',
    description: '检索 Google Drive 文档并归纳要点',
    usage: '12.8 万人使用',
    color: '#0f9d58',
    install: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
      envHints: ['GOOGLE_APPLICATION_CREDENTIALS'],
    },
  },
  {
    id: 'eastmoney',
    name: '东方财富',
    category: 'finance',
    description: '查询行情、资金流向与持仓研报数据',
    usage: '6.3 万人使用',
    color: '#e64545',
  },
  {
    id: 'wind',
    name: 'Wind 金融终端',
    category: 'finance',
    description: '接入 Wind 数据接口，获取专业金融数据',
    usage: '3.1 万人使用',
    color: '#1b4d8f',
  },
  {
    id: 'wechat-pay',
    name: '微信支付',
    category: 'finance-pay',
    description: '对账、退款与经营数据分析',
    usage: '8.6 万人使用',
    color: '#07c160',
  },
  {
    id: 'alipay',
    name: '支付宝',
    category: 'finance-pay',
    description: '账单查询与经营分析',
    usage: '7.2 万人使用',
    color: '#1677ff',
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    category: 'media',
    description: '文本生成图像，支持风格参考与局部重绘',
    usage: '23.5 万人使用',
    color: '#1f2937',
  },
  {
    id: 'suno',
    name: 'Suno',
    category: 'media',
    description: '根据描述生成完整歌曲与伴奏',
    usage: '11.9 万人使用',
    color: '#111111',
  },
  {
    id: 'runway',
    name: 'Runway',
    category: 'media',
    description: '视频生成与剪辑，衔接创意与成片',
    usage: '5.4 万人使用',
    color: '#111111',
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    category: 'content',
    description: '生成种草文案、选题与标题建议',
    usage: '19.3 万人使用',
    color: '#ff2442',
  },
  {
    id: 'wechat-mp',
    name: '微信公众号',
    category: 'content',
    description: '撰写长文、润色排版并生成摘要',
    usage: '16.8 万人使用',
    color: '#07c160',
  },
  {
    id: 'douyin',
    name: '抖音',
    category: 'marketing',
    description: '批量生成短视频脚本与投放素材',
    usage: '18.1 万人使用',
    color: '#161823',
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'marketing',
    description: '管理营销线索，生成跟进邮件与话术',
    usage: '6.8 万人使用',
    color: '#ff7a59',
  },
  {
    id: 'taobao',
    name: '淘宝开放平台',
    category: 'ecommerce',
    description: '商品数据检索与店铺经营分析',
    usage: '4.2 万人使用',
    color: '#ff5000',
  },
  {
    id: 'jd',
    name: '京东',
    category: 'ecommerce',
    description: '商品与订单数据查询，辅助选品决策',
    usage: '3.6 万人使用',
    color: '#e1251b',
  },
  {
    id: 'dingtalk-workflow',
    name: '飞书多维表格',
    category: 'management',
    description: '读写多维表格，沉淀项目与客户数据',
    usage: '10.5 万人使用',
    color: '#3370ff',
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'management',
    description: '查询迭代与任务进展，输出项目周报',
    usage: '9.4 万人使用',
    color: '#0052cc',
  },
  {
    id: 'notion-calendar',
    name: '日程助手',
    category: 'efficiency',
    description: '创建与整理日程，待办自动归集',
    usage: '13.7 万人使用',
    color: '#f43f5e',
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'efficiency',
    description: '看板任务读写，跟踪交付进度',
    usage: '4.9 万人使用',
    color: '#0079bf',
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    category: 'analytics',
    description: '查询数仓数据，生成指标解读与趋势分析',
    usage: '5.8 万人使用',
    color: '#4285f4',
  },
  {
    id: 'metabase',
    name: 'Metabase',
    category: 'analytics',
    description: '用自然语言查询业务库与看板数据',
    usage: '4.3 万人使用',
    color: '#111111',
  },
  {
    id: 'medical-record',
    name: '电子病历助手',
    category: 'medical',
    description: '整理病历要点，辅助生成诊疗记录',
    usage: '2.6 万人使用',
    color: '#0ea5e9',
  },
  {
    id: 'fadao',
    name: '法大大',
    category: 'legal',
    description: '合同条款审阅与风险点提示',
    usage: '3.5 万人使用',
    color: '#1d4ed8',
  },
  {
    id: 'tax-assistant',
    name: '智能税务',
    category: 'legal',
    description: '发票识别与进项税归集',
    usage: '2.9 万人使用',
    color: '#f59e0b',
  },
  {
    id: 'map',
    name: '地图出行',
    category: 'life',
    description: '路线规划与周边信息检索',
    usage: '8.1 万人使用',
    color: '#10b981',
  },
  {
    id: 'weather',
    name: '天气助手',
    category: 'life',
    description: '实时天气与出行提醒',
    usage: '5.2 万人使用',
    color: '#38bdf8',
  },
  {
    id: 'arxiv',
    name: 'arXiv 论文',
    category: 'research',
    description: '检索论文并生成综述与要点提炼',
    usage: '7.7 万人使用',
    color: '#b31b1b',
  },
  {
    id: 'zotero',
    name: 'Zotero',
    category: 'research',
    description: '管理文献库，一键生成引用与笔记',
    usage: '4.4 万人使用',
    color: '#cc2936',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'engineering',
    description: '读写 Issue 与 PR，检索仓库代码',
    usage: '32.1 万人使用',
    color: '#24292f',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'engineering',
    description: '管理流水线与合并请求',
    usage: '6.5 万人使用',
    color: '#fc6d26',
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    category: 'engineering',
    description: '查询构建任务与发布记录',
    usage: '3.8 万人使用',
    color: '#d33833',
  },
  {
    id: 'law-database',
    name: '法律法规库',
    category: 'law-research',
    description: '检索法规条文与判例，输出合规建议',
    usage: '3.1 万人使用',
    color: '#7c3aed',
  },
  {
    id: 'sec-filings',
    name: 'SEC 披露',
    category: 'law-research',
    description: '检索上市公司披露文件并归纳关键变化',
    usage: '1.8 万人使用',
    color: '#0f172a',
  },
];

/** 按 id 查找目录项 */
export function findCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.id.toLowerCase() === id.toLowerCase());
}
