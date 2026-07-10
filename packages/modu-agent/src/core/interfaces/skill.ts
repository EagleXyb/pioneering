// 对应 Python: core/interfaces/skill.py
// BaseSkill 抽象接口（P1 Skills 能力）
import type { BaseTool } from './action.js'

/**
 * Skill 抽象基类。
 * 对应 Python BaseSkill。
 *
 * 设计要点：
 *   - Skill 在运行时对图完全透明：最终降解为 (N 个 BaseTool) + (一段 system prompt 片段)。
 *   - graph / nodes / ToolNode / ReAct 循环均无需感知 Skill 的存在。
 *   - 所有组件方法保持默认实现，子类按需覆写。
 */
export abstract class BaseSkill {
  // ---------- 身份与元数据 ----------

  /** Skill 唯一标识 */
  abstract name(): string

  /** 面向 LLM 的能力描述（会注入 system prompt） */
  abstract description(): string

  /** 版本号 */
  abstract version(): string

  /** 分类标签，用于发现与按需加载 */
  tags(): string[] {
    return []
  }

  /** few-shot 示例，可选，注入提示。每项形如 { input, output } */
  examples(): Array<Record<string, string>> {
    return []
  }

  /** 前置条件：所需配置/依赖/权限 scope */
  preconditions(): Record<string, any> {
    return {}
  }

  /** 细粒度权限声明 */
  requiredScopes(): string[] {
    return []
  }

  // ---------- 封装性 ----------

  /** 该 Skill 暴露的原子工具集合（可为空，纯提示型 Skill） */
  tools(): BaseTool[] {
    return []
  }

  /** 注入 LLM 的专属指令片段（如角色设定、工具使用规范） */
  systemPromptFragment(): string | null {
    return null
  }

  // ---------- 生命周期 ----------

  /** 健康检查：依赖缺失/配置不全时返回 false，触发降级 */
  isAvailable(): boolean {
    return true
  }

  /** 注册时一次性初始化（加载资源、建连接等）。异常被 Loader 隔离 */
  setup(): void {
    /* 默认无操作 */
  }

  /** 卸载/进程退出时清理 */
  teardown(): void {
    /* 默认无操作 */
  }
}
