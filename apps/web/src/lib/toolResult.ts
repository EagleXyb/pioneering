/**
 * 工具观测结果（TAO 的 Observation）结构化识别
 *
 * agent 通道联网搜索工具（search_engine）的观测是 JSON 字符串：
 *   {"tool":"search_engine","status":"success","data":{"results":[{title,url,snippet,source}],"source":"bing"}}
 * 前端把它解析为「来源列表」交给 WorkBuddy 风格的搜索结果卡片渲染；
 * 其它工具（read_file / run 等）返回 null，由调用方回退原始 JSON 展示。
 *
 * 容错：持久化的 tool_result.summary 会被截断（agent-bridge 截到 800 字符，
 * tool-adapter 可能追加 "...[truncated]"），JSON.parse 因而不保证成功 ——
 * 此时退化为括号配对扫描，尽量保住已完整到达的结果条目。
 *
 * 识别口径与 apps/desktop 的 embedded-tool-results 一致（同一套 WorkBuddy 风格）。
 */

/** 单条搜索结果（后端 data.results 的元素） */
export interface SearchResultItem {
  title: string;
  url?: string;
  snippet?: string;
  /** 搜索引擎名（bing / tavily / duckduckgo …），非站点域名 */
  source?: string;
}

export interface SearchToolResult {
  kind: 'search';
  results: SearchResultItem[];
  /** 本次检索使用的引擎 */
  source?: string;
}

/** 超限追加的截断标记（tool-adapter._truncateToolResult） */
const TRUNCATION_MARK = /\.\.\.\[truncated\]\s*$/;

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 单个结果对象规范化：title 必须为字符串，其余字段按需读取 */
function normalizeItem(value: unknown): SearchResultItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.title !== 'string' || !o.title) return null;
  return {
    title: o.title,
    url: typeof o.url === 'string' ? o.url : undefined,
    snippet: typeof o.snippet === 'string' ? o.snippet : undefined,
    source: typeof o.source === 'string' ? o.source : undefined,
  };
}

/** data.results → 规范化列表 */
function pickResults(data: Record<string, unknown>): SearchResultItem[] {
  if (!Array.isArray(data.results)) return [];
  return data.results
    .map(normalizeItem)
    .filter((item): item is SearchResultItem => item !== null);
}

/**
 * 截断 JSON 兜底：定位 "results": [ 后按括号配对逐个提取完整的结果对象，
 * 丢弃被腰斩的最后一项，避免整块观测退化成原始 JSON。
 */
function salvageResults(text: string): SearchResultItem[] {
  const at = text.indexOf('"results"');
  if (at < 0) return [];
  const start = text.indexOf('[', at);
  if (start < 0) return [];

  const out: SearchResultItem[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && objStart >= 0) {
        const item = normalizeItem(tryParse(text.slice(objStart, i + 1)));
        if (item) out.push(item);
        objStart = -1;
      }
      continue;
    }
    if (ch === ']' && depth === 0) break;
  }
  return out;
}

/**
 * 观测结果 → 结构化搜索结果。
 * 非搜索类结果（文件内容、时间、纯文本…）返回 null。
 */
export function parseSearchToolResult(raw?: string): SearchToolResult | null {
  if (!raw) return null;
  const text = raw.trim().replace(TRUNCATION_MARK, '').trim();
  if (!text.startsWith('{')) return null;

  const parsed = tryParse(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    // 兼容 { tool, status, data:{results} } 与裸 { results } 两种口径
    const data =
      obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
        ? (obj.data as Record<string, unknown>)
        : obj;
    const results = pickResults(data);
    if (results.length > 0) {
      return {
        kind: 'search',
        results,
        source: typeof data.source === 'string' ? data.source : undefined,
      };
    }
  }

  const salvaged = salvageResults(text);
  if (salvaged.length === 0) return null;
  // source 通常写在 results 之后（被截断时丢失）：尽力而为
  const engine = /"source"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  return { kind: 'search', results: salvaged, source: engine };
}

/** 从 URL 提取站点域名（favicon 用）；非法 URL 返回空串 */
export function resultDomain(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
