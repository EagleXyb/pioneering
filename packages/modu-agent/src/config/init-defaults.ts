// init-defaults.ts
//
// 首次安装初始化器：打包成安装包后，第一次运行/安装时自动生成一套
// 默认配置模板文件（AGENTS.md / SOUL.md / USER.md / MEMORY.md + config.yaml）。
//
// 设计原则：
//   1. 幂等：只写入"缺失"的文件，绝不覆盖用户已存在/已修改的文件。
//   2. 原子写：先写临时文件再 rename，避免写入中断产生半截文件。
//   3. 纯增强：不改变任何既有运行时逻辑；由宿主在安装/首次启动时显式调用一次。
//   4. 模板内容与仓库领域（编码助手）及文档 4.5 规范对齐，开箱即用。

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

// ESM 下无全局 __dirname（package.json 为 "type": "module"），按需以 import.meta.url 推导
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.init] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.init] ${msg}`, ...args),
}

/** 约定模板文件 → 默认内容（内容为 UTF-8 文本）。 */
export interface DefaultTemplate {
  /** 相对文件名（如 AGENTS.md / config.yaml） */
  fileName: string
  /** 模板正文 */
  content: string
}

/**
 * 内置默认模板集合。
 * - 文本模板（*.md）使用 Markdown 文档格式，可带 YAML frontmatter。
 * - config.yaml 内置 markdown_prompt.enabled: true，使首次安装即可用。
 */
export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    fileName: 'AGENTS.md',
    content: [
      '---',
      'inject_to: system_prompt',
      'load: eager',
      'cascade_level: global',
      '---',
      '# AGENTS（全局行为准则 / 工作流 SOP）',
      '',
      '你是 pioneering 的编码助手 Agent，遵循以下准则：',
      '1. 输出可运行、高质量的代码，优先复用仓库已有模块。',
      '2. 使用简体中文回答。',
      '3. 修改代码前先理解上下文，不破坏既有业务逻辑。',
      '4. 对不确定的假设先说明再执行。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'SOUL.md',
    content: [
      '---',
      'inject_to: system_prompt',
      'load: eager',
      'cascade_level: project',
      '---',
      '# SOUL（人格 / 语气 / 边界）',
      '',
      '语气：专业、克制、直接。',
      '边界：只做编码与工程辅助，不越权执行破坏性操作。',
      '风格：给出结论时附带依据；给出代码时附带可运行示例。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'USER.md',
    content: [
      '---',
      'inject_to: runtime_context',
      'load: eager',
      'cascade_level: user',
      '---',
      '# USER（用户画像）',
      '',
      '语言偏好：简体中文。',
      '协作方式：期望得到可落地的实现与清晰说明。',
      '',
    ].join('\n'),
  },
  {
    fileName: 'MEMORY.md',
    content: [
      '---',
      'inject_to: runtime_context',
      'load: lazy',
      'cascade_level: user',
      '---',
      '# MEMORY（长期记忆 / 经验，按需加载）',
      '',
      '<!-- 此文件为长期记忆模板，经验沉淀由 writeMemoryToMarkdownFile 写入。 -->',
      '',
    ].join('\n'),
  },
  {
    fileName: 'config.yaml',
    content: [
      '# pioneering modu-agent 默认配置模板（首次安装自动生成，可安全修改）',
      '',
      'react_optimization:',
      '  # 4.5 风险①：Markdown 文档提示注入（首次安装默认开启，配合下方 .md 模板）',
      '  markdown_prompt:',
      '    enabled: true',
      '    system_prompt_max_chars: 8000',
      '    runtime_context_max_chars: 4000',
      '',
      '# 示例：参数覆盖（类型不符会自动丢弃并回退默认，见 4.5 风险②）',
      '# llm:',
      '#   default_provider: deepseek',
      '#   temperature: 0.7',
      '',
    ].join('\n'),
  },
]

/** 各模板文件创建结果。 */
export interface InitResultEntry {
  /** 文件名 */
  fileName: string
  /** 绝对路径 */
  absPath: string
  /** created=true 表示本次新建；exists=true 表示已存在（跳过未覆盖）；skipped=true 表示写入失败跳过 */
  status: 'created' | 'exists' | 'skipped'
}

export interface InitDefaultsResult {
  /** 各文件的处理结果 */
  entries: InitResultEntry[]
  /** 本次新建的文件数 */
  created: number
  /** 已存在未覆盖的文件数 */
  existed: number
  /** 写入失败的文件数 */
  skipped: number
}

/**
 * 定位默认模板写入目录（项目根目录）。
 * 与 markdown-loader.getPackageRoot 一致；可用 rootDir 覆盖（便于测试与自定义安装路径）。
 */
export function getDefaultConfigRoot(): string {
  return path.resolve(__dirname, '..', '..')
}

/**
 * 原子写入文件：先写临时文件再 rename，避免中断产生半截文件。
 * 目录不存在时自动创建。
 */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`)
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, filePath)
}

/**
 * 首次安装初始化：幂等生成默认模板文件。
 *
 * 行为：
 *   - 只写入"不存在"的文件；已存在的文件跳过，绝不覆盖用户修改。
 *   - 单文件写入失败不影响其他文件（隔离），结果在 entries 中标注 skipped。
 *
 * @param opts.rootDir 模板写入目录（默认 getDefaultConfigRoot()）
 * @param opts.templates 模板集合（默认 DEFAULT_TEMPLATES）
 * @returns InitDefaultsResult
 */
export function initDefaultConfigFiles(
  opts: {
    rootDir?: string
    templates?: readonly DefaultTemplate[]
    logger?: { info?: (m: string, ...a: any[]) => void; warning?: (m: string, ...a: any[]) => void }
  } = {},
): InitDefaultsResult {
  const root = opts.rootDir ?? getDefaultConfigRoot()
  const templates = opts.templates ?? DEFAULT_TEMPLATES
  const lg = opts.logger ?? logger

  const entries: InitResultEntry[] = []
  let created = 0
  let existed = 0
  let skipped = 0

  for (const t of templates) {
    const absPath = path.join(root, t.fileName)
    try {
      if (fs.existsSync(absPath)) {
        entries.push({ fileName: t.fileName, absPath, status: 'exists' })
        existed++
        continue
      }
      atomicWrite(absPath, t.content)
      entries.push({ fileName: t.fileName, absPath, status: 'created' })
      created++
      lg.info?.('已生成默认模板: %s', absPath)
    } catch (e: any) {
      entries.push({ fileName: t.fileName, absPath, status: 'skipped' })
      skipped++
      lg.warning?.('生成模板失败 %s: %s', absPath, String(e?.message ?? e))
    }
  }

  return { entries, created, existed, skipped }
}

/**
 * 便捷函数：返回"首次安装是否需要初始化"。
 * 用于宿主判断是否应在启动时调用 initDefaultConfigFiles（可选，幂等故可安全每次都调）。
 */
export function hasDefaultConfigFiles(rootDir?: string): boolean {
  const root = rootDir ?? getDefaultConfigRoot()
  return DEFAULT_TEMPLATES.every((t) => fs.existsSync(path.join(root, t.fileName)))
}
