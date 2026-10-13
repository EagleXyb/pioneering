/**
 * 工具动作行（TAO 的 Action / Observation 节点）
 *
 * 截图同款交互：默认只占一行 ——「图标 + 动作摘要（动词 + 目标对象）+ 箭头」，
 * 不打断阅读节奏；点击展开后可见完整参数与观测结果，保留可追溯性。
 * 观测结果（工具返回）内联在本行展开区，构成“行动 → 观察”的闭环：
 *   - 联网搜索类结果 → WorkBuddy 风格来源卡片（站点图标 + 标题列表）
 *   - 其余结果 → 参数 / 观察原始 JSON（美化后展示）
 */
import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Clock,
  FilePen,
  FileText,
  FolderOpen,
  Globe,
  Search,
  SearchCode,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { describeToolAction, truncateTarget, type ToolIconKind } from '@/lib/toolAction';
import { parseSearchToolResult } from '@/lib/toolResult';
import { SearchResultsCard } from './SearchResultsCard';
import './taoBlocks.css';

const ICONS: Record<ToolIconKind, LucideIcon> = {
  search: Search,
  code: SearchCode,
  read: FileText,
  write: FilePen,
  edit: FilePen,
  run: SquareTerminal,
  list: FolderOpen,
  skill: Sparkles,
  web: Globe,
  time: Clock,
  tool: Wrench,
};

interface Props {
  toolName: string;
  /** 工具参数（TOOL_CALL_ARGS 累积的 JSON 字符串，可能不完整） */
  args?: string;
  /** 观测结果（TOOL_CALL_RESULT 的 content） */
  result?: string;
  /** 是否仍在执行（未拿到观测结果） */
  streaming?: boolean;
  /** 本轮 run 在该调用执行前就结束了（触顶/中止）：显示「未执行」，不再是执行中 */
  failed?: boolean;
  /**
   * 是否对搜索类目标做语义压缩（默认 true）。
   * 批次聚合的明细行关掉压缩：聚合行负责压缩，明细行给完整 query（对齐 WorkBuddy）。
   */
  compactTarget?: boolean;
}

/** 动作块（批次内明细行的数据源） */
export interface ToolRowItem {
  toolName: string;
  args?: string;
  result?: string;
  streaming?: boolean;
  /** 未执行（run 在该调用执行前结束） */
  failed?: boolean;
}

/** 观测/参数详情：能解析为 JSON 时美化，否则按原文展示 */
function formatDetail(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 搜索类动作行摘要的目标截断长度（完整 query 仍在展开区/来源卡片里） */
const SEARCH_TARGET_MAX_LEN = 26;

/** 批次聚合行主题（首条 query 关键词）的截断长度 */
const BATCH_TOPIC_MAX_LEN = 30;

export function ToolCallRow({
  toolName,
  args,
  result,
  streaming = false,
  failed = false,
  compactTarget = true,
}: Props) {
  const [open, setOpen] = useState(false);

  const { verb, target, icon } = describeToolAction(toolName, args);
  const Icon = ICONS[icon];
  const formattedArgs = formatDetail(args ?? '');
  const formattedResult = formatDetail(result ?? '');
  const hasDetail = formattedArgs.length > 0 || formattedResult.length > 0;
  // 联网搜索类观测 → 来源卡片；解析失败（非搜索 / 截断到不可恢复）回退原始 JSON
  const searchResult = useMemo(() => parseSearchToolResult(result), [result]);

  /**
   * 动作行摘要（豆包工作风格：可扫读的一行）
   * - 搜索类：`联网搜索「关键词…」· 参考 N 篇` —— 长 query 截断，用引号标示省略；
   * - 其它：沿用「动词 + 目标」；
   * 完整参数与观测结果始终在展开区（可追溯性不丢）。
   */
  const isSearch = icon === 'search' || icon === 'web';
  const shouldCompact = compactTarget && isSearch;
  const shownTarget = shouldCompact ? truncateTarget(target, SEARCH_TARGET_MAX_LEN) : target;
  // 截断 JSON 挽救出来的条数不完整，此时不报数字（避免给出错误统计）
  const referenceCount =
    searchResult && !searchResult.salvaged ? searchResult.results.length : 0;
  const refSuffix = referenceCount > 0 ? ` · 参考 ${referenceCount} 篇` : '';
  const summary = shownTarget
    ? shouldCompact
      ? `${verb}「${shownTarget}」${refSuffix}`
      : `${verb} ${shownTarget}`
    : verb;
  // 未执行：明确标注，避免看起来像"已完成但没有结果"
  const failedSuffix = failed && !streaming ? ' · 未执行' : '';

  return (
    <div
      className={`tao-tool${open ? ' is-open' : ''}${streaming ? ' is-streaming' : ''}`}
      data-tool-name={toolName}
    >
      <button
        type="button"
        className="tao-tool-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDetail}
        title={toolName}
      >
        <Icon size={14} strokeWidth={1.8} className="tao-tool-icon" />
        <span className="tao-tool-summary">{summary}{failedSuffix}</span>
        {hasDetail && (
          <ChevronRight size={14} strokeWidth={2.2} className="tao-tool-chevron" />
        )}
      </button>

      {open &&
        hasDetail &&
        (searchResult ? (
          <SearchResultsCard
            results={searchResult.results}
            source={searchResult.source}
            raw={formattedResult}
          />
        ) : (
          <div className="tao-tool-detail">
            {formattedArgs && (
              <div className="tao-tool-detail-section">
                <div className="tao-tool-detail-label">参数</div>
                <pre className="tao-tool-detail-pre">{formattedArgs}</pre>
              </div>
            )}
            {formattedResult && (
              <div className="tao-tool-detail-section">
                <div className="tao-tool-detail-label">观察</div>
                <pre className="tao-tool-detail-pre">{formattedResult}</pre>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

interface BatchProps {
  /** 动作动词（由首条动作推出，如「联网搜索」） */
  verb: string;
  /** 图标类别（同批次内一致） */
  icon: ToolIconKind;
  /** 批次内的动作明细（按到达顺序） */
  items: ToolRowItem[];
}

/**
 * 动作批次聚合行（对齐 WorkBuddy：`收集「<首条关键词>」等 5 条资料 ⌄`）
 *
 * 一轮里同类的多次调用（如并列的 5 条检索）默认只占一行**人话摘要**，
 * 展开后逐条显示明细 —— 明细行不做目标压缩，完整 query 与观测结果都保留，
 * 压缩与可追溯性各归其位。
 */
export function ToolBatchRow({ verb, icon, items }: BatchProps) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[icon];
  const isSearch = icon === 'search' || icon === 'web';
  // 人话摘要：以首条 query 的关键词作主题（截断），其余明细收在展开区
  const firstTarget = items[0]
    ? describeToolAction(items[0].toolName, items[0].args).target
    : '';
  const topic = firstTarget ? truncateTarget(firstTarget, BATCH_TOPIC_MAX_LEN) : '';
  const summary = isSearch
    ? topic
      ? `收集「${topic}」等 ${items.length} 条资料`
      : `${verb} ${items.length} 条查询`
    : `${verb} ${items.length} 次`;
  const anyStreaming = items.some((it) => it.streaming);
  const failedCount = items.filter((it) => it.failed && !it.streaming).length;
  const failedSuffix = failedCount > 0 ? ` · ${failedCount} 条未执行` : '';

  return (
    <div className={`tao-tool tao-tool--batch${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="tao-tool-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${summary}，展开查看明细`}
      >
        <Icon size={14} strokeWidth={1.8} className={`tao-tool-icon${anyStreaming ? ' is-live' : ''}`} />
        <span className="tao-tool-summary">{summary}{failedSuffix}</span>
        <ChevronRight size={14} strokeWidth={2.2} className="tao-tool-chevron" />
      </button>

      <div
        className={`tao-tool-batch-body-wrap${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="tao-tool-batch-body-inner">
          <div className="tao-tool-batch-body">
            {items.map((item, idx) => (
              <ToolCallRow
                key={`${item.toolName}-${idx}`}
                toolName={item.toolName}
                args={item.args}
                result={item.result}
                streaming={item.streaming}
                failed={item.failed}
                compactTarget={false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
