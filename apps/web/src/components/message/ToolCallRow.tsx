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
import { describeToolAction, type ToolIconKind } from '@/lib/toolAction';
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

export function ToolCallRow({ toolName, args, result, streaming = false }: Props) {
  const [open, setOpen] = useState(false);

  const { verb, target, icon } = describeToolAction(toolName, args);
  const Icon = ICONS[icon];
  const summary = target ? `${verb} ${target}` : verb;
  const formattedArgs = formatDetail(args ?? '');
  const formattedResult = formatDetail(result ?? '');
  const hasDetail = formattedArgs.length > 0 || formattedResult.length > 0;
  // 联网搜索类观测 → 来源卡片；解析失败（非搜索 / 截断到不可恢复）回退原始 JSON
  const searchResult = useMemo(() => parseSearchToolResult(result), [result]);

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
        <Icon size={15} strokeWidth={1.8} className="tao-tool-icon" />
        <span className="tao-tool-summary">{summary}</span>
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
