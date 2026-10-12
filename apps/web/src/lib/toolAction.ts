/**
 * 工具调用 → 人类可读动作描述
 *
 * 动作行（TAO 的 Action 节点）不暴露原始工具名与 JSON，而是渲染为
 * “动词 + 目标对象”的一行摘要（截图样式：如 “运行 第一个节点是文档《F…”），
 * 具体参数与观测结果保留在展开区，兼顾可读性与可追溯性。
 *
 * 纯函数：toolName → 动词/图标，args → 目标对象（优先完整 JSON，流式未闭合
 * 时退化为正则粗提取）。
 */

export type ToolIconKind =
  | 'search'
  | 'code'
  | 'read'
  | 'write'
  | 'edit'
  | 'run'
  | 'list'
  | 'skill'
  | 'web'
  | 'time'
  | 'tool';

export interface ToolActionDescriptor {
  /** 动作动词（如 “查看文件”“运行命令”） */
  verb: string;
  /** 目标对象（文件路径 / 查询词 / 命令 …）；提取不到时为空串 */
  target: string;
  /** 图标类别（组件据此选择具体图标） */
  icon: ToolIconKind;
}

/** 工具名 → 动词/图标（顺序敏感：具体规则在前，泛化规则在后） */
const VERB_RULES: ReadonlyArray<{ test: RegExp; verb: string; icon: ToolIconKind }> = [
  // 联网搜索族（含 agent 通道的 search_engine）：动词“联网搜索”+ 地球图标，
  // 与 WorkBuddy 风格动作行一致（magnifier 留给本地/代码检索）
  { test: /web_?search|search_?web|search_?engine|bing_?search|google_?search|baidu_?search|tavily|serper/i, verb: '联网搜索', icon: 'web' },
  { test: /search_?code|grep|ripgrep|code_?search/i, verb: '搜索代码', icon: 'code' },
  { test: /search/i, verb: '搜索', icon: 'search' },
  { test: /read_?file|view_?file|file_?read|get_?file|^read$|^view$/i, verb: '查看文件', icon: 'read' },
  { test: /write_?file|create_?file|file_?write|save_?file|doc_?writer/i, verb: '写入文件', icon: 'write' },
  { test: /edit_?file|str_?replace|apply_?patch|replace_?in_?file/i, verb: '修改文件', icon: 'edit' },
  { test: /^run$|bash|shell|^exec$|execute|run_?command|terminal|^cmd$|^command$/i, verb: '运行命令', icon: 'run' },
  { test: /list_?dir|list_?files|^ls$|glob|browse_?dir/i, verb: '浏览目录', icon: 'list' },
  { test: /skill|library/i, verb: '加载技能', icon: 'skill' },
  { test: /fetch|http_?get|download|^url$|crawl/i, verb: '抓取网页', icon: 'web' },
  { test: /datetime|^time$|clock|now/i, verb: '获取时间', icon: 'time' },
];

/** 目标对象候选键（按语义优先级排序） */
const TARGET_KEYS = [
  'path',
  'file_path',
  'filePath',
  'file',
  'filename',
  'command',
  'cmd',
  'query',
  'q',
  'url',
  'skill',
  'skill_id',
  'skillId',
  'name',
  'pattern',
  'title',
  'prompt',
  'text',
] as const;

/** 目标对象最长展示长度（超出截断，完整内容在展开区） */
const TARGET_MAX_LEN = 80;

/** 取值：字符串直接用；数组取第一个非空字符串（如 {"paths":["a.md"]}） */
function normalizeValue(v: unknown): string {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === 'string' && x.trim());
    if (typeof first === 'string') return first.trim();
  }
  return '';
}

function pickFromObject(obj: Record<string, unknown>): string {
  // ① 精确键优先（按语义优先级）
  for (const key of TARGET_KEYS) {
    const hit = normalizeValue(obj[key]);
    if (hit) return hit;
  }
  // ② 复数/变体键（paths / files / queries …）
  const keys: readonly string[] = TARGET_KEYS;
  for (const [k, v] of Object.entries(obj)) {
    const base = k.replace(/s$/, '');
    if (keys.includes(base)) {
      const hit = normalizeValue(v);
      if (hit) return hit;
    }
  }
  return '';
}

/**
 * 从 args 中提取目标对象。
 * 流式期间 TOOL_CALL_ARGS 是不完整的 JSON 片段，整体 parse 会失败，
 * 此时用正则粗提取“首个可用字符串值”，保证动作行尽早可读。
 */
export function extractToolTarget(args?: string): string {
  if (!args) return '';
  const trimmed = args.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const hit = pickFromObject(parsed as Record<string, unknown>);
      if (hit) return hit;
    }
  } catch {
    // 不完整 JSON：继续走正则粗提取
  }

  for (const key of TARGET_KEYS) {
    // 兼容复数键与数组形式（"paths": ["a.md"]）——流式未闭合时也能尽早给出目标
    const m = new RegExp(`"${key}s?"\\s*:\\s*\\[?\\s*"([^"]{1,200})`).exec(trimmed);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return '';
}

/** 截断目标对象（保留可读性，完整内容在展开区可见） */
export function truncateTarget(target: string, max = TARGET_MAX_LEN): string {
  if (target.length <= max) return target;
  return `${target.slice(0, max)}…`;
}

/** 工具调用 → 动作描述 */
export function describeToolAction(toolName: string, args?: string): ToolActionDescriptor {
  const name = (toolName ?? '').trim();
  const rule = VERB_RULES.find((r) => r.test.test(name));
  const rawTarget = extractToolTarget(args);
  return {
    verb: rule?.verb ?? (name || '调用工具'),
    target: rawTarget ? truncateTarget(rawTarget) : '',
    icon: rule?.icon ?? 'tool',
  };
}
