// P1-5: 工具能力矩阵 + 意图路由（对应文档 §1.2 策略 A + §5.2 P1-5）
//
// 构建 TOoL_CAPABILITY_MATRIX 独立注册表，描述工具的能力维度：
//   - task_types: 工具适用的任务类型（research/coding/review/default）
//   - intents: 工具可处理的意图关键词（如 "结构化数据查询" → sql_executor）
//   - requires_confirmation: 是否需要人工审批
//   - fallback_chain: 同类工具的降级链
//
// 与 ComponentRegistry 的职责区分（对应文档执行建议1）：
//   - ComponentRegistry: 管理工具生命周期（注册/获取/列表）
//   - TOOL_CAPABILITY_MATRIX: 描述工具能力维度（任务类型/意图/审批要求）
//
// 两级管道（对应文档执行建议2 + 风险 R-09 策略①）：
//   1. task_type 粗筛：按 task_type 过滤工具集
//   2. intent 细筛：在粗筛结果中按 intent 关键词进一步过滤
//   intent 匹配失败（返回空）时回退到 task_type 粗筛结果（等价现状）
//
// 风险控制（对应风险登记表 R-09）：
//   - intent 匹配失败回退到 task_type 结果，避免工具集过窄
//   - fallback_chain 仅作为 prompt 中的建议文本，不自动执行
//   - plan-execute 模式复用同一 TOOL_CAPABILITY_MATRIX

/**
 * 工具能力描述。
 *
 * 描述单个工具在任务路由维度上的能力属性。
 * 不替代 ComponentRegistry 的生命周期管理，仅用于工具选择决策。
 */
export interface ToolCapability {
  /** 工具名（与 BaseTool.name() 一致） */
  name: string
  /** 适用的任务类型列表（research/coding/review/default） */
  task_types: string[]
  /**
   * 意图关键词映射：key=意图描述，value=是否为该意图的首选工具。
   *
   * 仅当 value=true 的工具会在 intent 细筛中被选中。
   * value=false 表示"可处理但非首选"，仅在无首选时作为候选。
   */
  intents?: Record<string, boolean>
  /** 是否需要人工审批（对应 P2-1 ACTION_GUARDRAILS） */
  requires_confirmation?: boolean
  /** 降级链：本工具不可用时可尝试的同类工具（仅作为 prompt 建议，不自动执行） */
  fallback_chain?: string[]
}

/**
 * 工具能力矩阵注册表。
 *
 * 预置内置工具的能力描述（与 src/tools/index.ts 导出的工具对齐）：
 *   - search_engine: research 类，处理"外部信息检索/新闻/天气"意图
 *   - http_request: research 类，处理"外部 API 数据"意图
 *   - calculator: coding 类，处理"数值计算"意图
 *   - code_executor: coding 类，处理"代码执行/脚本"意图
 *   - sql_query: research/coding 类，处理"结构化数据查询"意图
 *   - datetime: research/default 类，处理"日期/时间"意图
 *   - file_ops: default 类（写操作需审批）
 *
 * 宿主可通过 registerToolCapability 追加或覆盖条目（如 MCP 工具）。
 */
export const TOOL_CAPABILITY_MATRIX: Record<string, ToolCapability> = {
  search_engine: {
    name: 'search_engine',
    task_types: ['research'],
    intents: {
      '外部信息检索': true,
      '新闻': true,
      '天气': true,
      '股价': true,
      '实时数据': true,
    },
    requires_confirmation: false,
    fallback_chain: ['http_request'],
  },
  http_request: {
    name: 'http_request',
    task_types: ['research'],
    intents: {
      '外部API数据': true,
      'URL抓取': true,
    },
    requires_confirmation: true,
    fallback_chain: ['search_engine'],
  },
  calculator: {
    name: 'calculator',
    task_types: ['coding'],
    intents: {
      '数值计算': true,
      '算术': true,
    },
    requires_confirmation: false,
  },
  code_executor: {
    name: 'code_executor',
    task_types: ['coding'],
    intents: {
      '代码执行': true,
      '脚本运行': true,
      '数据处理': true,
    },
    requires_confirmation: true,
  },
  sql_query: {
    name: 'sql_query',
    task_types: ['research', 'coding'],
    intents: {
      '结构化数据查询': true,
      '数据库查询': true,
      'SQL': true,
    },
    requires_confirmation: true,
  },
  datetime: {
    name: 'datetime',
    task_types: ['research', 'default'],
    intents: {
      '日期': true,
      '时间': true,
      '当前时间': true,
    },
    requires_confirmation: false,
  },
  file_ops: {
    name: 'file_ops',
    task_types: ['default'],
    intents: {
      '文件读写': true,
      '文件操作': true,
    },
    requires_confirmation: true,
  },
}

/**
 * 注册或覆盖工具能力描述。
 *
 * @param capability 工具能力描述（name 必填）
 */
export function registerToolCapability(capability: ToolCapability): void {
  if (!capability.name) throw new Error('ToolCapability.name must be non-empty')
  TOOL_CAPABILITY_MATRIX[capability.name] = capability
}

/**
 * 查询工具能力描述。
 *
 * @param name 工具名
 * @returns 能力描述；未注册时返回 null（不抛异常）
 */
export function getToolCapability(name: string): ToolCapability | null {
  return TOOL_CAPABILITY_MATRIX[name] ?? null
}

/**
 * 第一级管道：按 task_type 粗筛工具集。
 *
 * 行为与原 _filterToolsByTaskType 对齐（向后兼容）：
 *   - task_type='default' 或未知：返回全部工具（保守策略）
 *   - task_type='review'：返回空数组（纯 LLM 评审，无工具）
 *   - 其他 task_type：返回 task_types 包含该 task_type 的工具
 *
 * @param tools 工具实例数组（LangChain StructuredTool 或 BaseTool wrapper）
 * @param taskType 任务类型
 * @returns 过滤后的工具数组
 */
export function filterToolsByTaskType(tools: any[], taskType: string): any[] {
  // review: 纯 LLM 评审，无工具
  if (taskType === 'review') return []

  // default 或未知 task_type：保守返回全部工具（等价原 _filterToolsByTaskType 未知分支）
  if (taskType === 'default' || !TOOL_CAPABILITY_MATRIX_KEYS_INCLUDE(taskType)) {
    return tools
  }

  const allCapabilities = Object.values(TOOL_CAPABILITY_MATRIX)
  const matchingNames = new Set(
    allCapabilities
      .filter((c) => c.task_types.includes(taskType))
      .map((c) => c.name),
  )

  // task_type 在矩阵中存在但无工具声明该 task_type 时，保守返回全部
  if (matchingNames.size === 0) {
    return tools
  }

  return tools.filter((t) => {
    const name = typeof t.name === 'string' ? t.name : (t.name?.() ?? '')
    return matchingNames.has(name)
  })
}

/**
 * 检查矩阵中是否有任何工具声明了该 task_type。
 *
 * 用于区分"已知 task_type（矩阵中有工具声明）"与"未知 task_type（保守返回全部）"。
 */
function TOOL_CAPABILITY_MATRIX_KEYS_INCLUDE(taskType: string): boolean {
  for (const cap of Object.values(TOOL_CAPABILITY_MATRIX)) {
    if (cap.task_types.includes(taskType)) return true
  }
  return false
}

/**
 * 第二级管道：按 intent 细筛工具集。
 *
 * 在 task_type 粗筛结果中，按 intent 关键词进一步过滤：
 *   1. 查找 intents 中 intent 对应 value=true 的工具（首选工具）
 *   2. 若无首选，查找 intents 中包含该 intent 的工具（候选）
 *   3. 仍无匹配时返回 null（调用方回退到 task_type 粗筛结果）
 *
 * @param tools task_type 粗筛后的工具数组
 * @param intent 意图关键词（如 "结构化数据查询"）
 * @returns 细筛后的工具数组；无匹配时返回 null（触发回退）
 */
export function filterToolsByIntent(tools: any[], intent: string): any[] | null {
  if (!intent) return null

  // 收集工具名 → 实例映射
  const toolByName = new Map<string, any>()
  for (const t of tools) {
    const name = typeof t.name === 'string' ? t.name : (t.name?.() ?? '')
    if (name) toolByName.set(name, t)
  }

  // 第一轮：首选工具（intents[intent] === true）
  const preferred: any[] = []
  for (const [name, tool] of toolByName) {
    const cap = TOOL_CAPABILITY_MATRIX[name]
    if (cap?.intents && cap.intents[intent] === true) {
      preferred.push(tool)
    }
  }
  if (preferred.length > 0) return preferred

  // 第二轮：候选工具（intents 中包含该 intent key，无论 value）
  const candidates: any[] = []
  for (const [name, tool] of toolByName) {
    const cap = TOOL_CAPABILITY_MATRIX[name]
    if (cap?.intents && intent in cap.intents) {
      candidates.push(tool)
    }
  }
  if (candidates.length > 0) return candidates

  // 无匹配：返回 null 触发回退
  return null
}

/**
 * 两级管道：task_type 粗筛 → intent 细筛（带回退）。
 *
 * 对应文档 §5.2 P1-5 执行建议2 + 风险 R-09 策略①：
 *   1. 先按 task_type 粗筛
 *   2. 若 intent 非空，在粗筛结果中按 intent 细筛
 *   3. intent 细筛返回 null（无匹配）时，回退到 task_type 粗筛结果（等价现状）
 *
 * @param tools 工具实例数组
 * @param taskType 任务类型
 * @param intent 意图关键词（可选；空/null 时仅做 task_type 粗筛）
 * @returns 过滤后的工具数组
 */
export function filterToolsByTaskTypeAndIntent(
  tools: any[],
  taskType: string,
  intent?: string | null,
): any[] {
  // 第一级：task_type 粗筛
  const coarse = filterToolsByTaskType(tools, taskType)

  // 无 intent 或粗筛结果为空：直接返回粗筛结果
  if (!intent || coarse.length === 0) {
    return coarse
  }

  // 第二级：intent 细筛
  const fine = filterToolsByIntent(coarse, intent)

  // intent 细筛无匹配：回退到 task_type 粗筛结果（等价现状）
  return fine ?? coarse
}
