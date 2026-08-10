// 文档专用写入工具（DocWriterTool）
//
// 面向"生成文档"场景的专用工具，与通用 FileOpsTool 并存：
//   - FileOpsTool：通用文件读写，写操作需人工审批，路径校验严格
//   - DocWriterTool：文档生成专用，默认不需审批，支持自动命名+写后校验
//
// 核心能力：
//   1. 自动文件名生成：auto_name=true 时按 {title}_{YYYY-MM-DD}.md 生成
//   2. 写后校验：写完读取文件验证内容非空、大小匹配
//   3. 返回产物元信息：name/path/size/summary/format，供 Artifact 追踪
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BaseTool } from '../core/interfaces/action.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[doc-writer] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[doc-writer] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[doc-writer] ${msg}`, ...args),
}

/** 生成当前日期字符串（YYYY-MM-DD） */
function _dateStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** 将标题转为安全文件名片段（去除非法字符，空格转下划线） */
function _sanitizeTitle(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .trim()
    || 'document'
}

/**
 * 文档专用写入工具。
 *
 * 面向 LLM 文档生成场景，支持：
 *   - auto_name：自动生成含日期的文件名（如 AI_Agent新闻日报_2026-08-08.md）
 *   - validate：写后读取校验内容完整性
 *   - 返回结构化产物元信息供 Artifact 追踪
 */
export class DocWriterTool extends BaseTool {
  private _allowedRoot: string

  constructor(allowedRoot?: string | null) {
    super()
    if (allowedRoot) {
      this._allowedRoot = path.resolve(allowedRoot)
    } else {
      const envRoot = process.env.MODU_DOC_WRITER_ROOT
      if (envRoot) {
        this._allowedRoot = path.resolve(envRoot)
      } else {
        // 默认不再使用 os.tmpdir()，因为临时目录会被系统定期清理，导致生成的文档丢失。
        // 改用跨平台稳定的 ~/.pioneering/documents。
        this._allowedRoot = path.resolve(os.homedir(), '.pioneering', 'documents')
      }
    }
    fs.mkdirSync(this._allowedRoot, { recursive: true })
  }

  name(): string {
    return 'doc_writer'
  }

  description(): string {
    return (
      '【文档生成专用工具】创建或写入 Markdown 文档（.md 文件）。' +
      '当用户要求"生成文档/生成报告/整理成文档/写成报告/总结成文档/创建日报/创建周报"等时，必须使用此工具。' +
      '支持自动文件名生成（auto_name=true + title → 自动生成 {title}_{YYYY-MM-DD}.md），' +
      '写后自动校验内容完整性（validate=true），返回文档元信息（路径、大小、摘要）。' +
      '不要使用 file_ops 写文档——file_ops 是通用文件操作工具，写文档必须用 doc_writer。'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          description: '操作类型：create（新建/覆盖）/ append（追加到已有文件）。默认 create',
          enum: ['create', 'append'],
          default: 'create',
        },
        title: {
          type: 'string',
          description:
            '【强烈建议提供】文档标题，用于自动命名和展示。' +
            '若未提供，工具会自动从 content 的首个 Markdown # 标题提取，仍失败时则生成默认 document_日期.md。' +
            '建议示例："AI Agent行业新闻日报_2026-08-08"',
        },
        content: {
          type: 'string',
          description: '【必填】完整的 Markdown 文档内容，必须是结构良好的 Markdown 格式',
        },
        path: {
          type: 'string',
          description:
            '【可选】指定文件路径（相对工作目录，建议省略使用 auto_name 自动命名）。' +
            '只有当你需要覆盖/追加到一个已存在的精确路径时才填写',
        },
        auto_name: {
          type: 'boolean',
          description:
            '是否自动生成文件名（{title}_{YYYY-MM-DD}.md）。默认 true，强烈建议保持默认。' +
            '如果填了 path 则此项无效（直接使用 path）',
          default: true,
        },
        summary: {
          type: 'string',
          description: '【可选】文档摘要（一句话核心内容，用于产物预览）',
        },
        validate: {
          type: 'boolean',
          description: '写后是否校验内容完整性。默认 true',
          default: true,
        },
      },
      // 关键修复：只把 content 放 required，不再把 title 硬加入 required。
      // 原因：LangChain DynamicStructuredTool 会先 Zod.parse() 校验 schema，校验失败时直接返回
      // "Received tool input did not match expected schema"，根本不会进入 invoke 容错逻辑。
      // 改为仅 content 必填，title / path / auto_name 全部由 invoke 内的容错智能降级处理。
      required: ['content'],
    }
  }

  /** 文档生成是用户明确请求的产物，默认不需审批 */
  requiresApproval(): boolean {
    return false
  }

  followUpTools(): string[] {
    // 文档写入后推荐读取验证
    return ['file_ops']
  }

  /** 工作目录根路径 */
  get allowedRoot(): string {
    return this._allowedRoot
  }

  /**
   * 校验路径在工作目录内，返回绝对路径。
   * 复用 FileOpsTool 的安全策略：拒绝绝对路径、.. 穿越、符号链接外指。
   */
  private _validatePath(relPath: string): string {
    if (!relPath) {
      throw new Error('Path is empty')
    }
    if (path.isAbsolute(relPath) || /^[CDEF]:/i.test(relPath.slice(0, 2))) {
      throw new Error(`Absolute path not allowed: ${relPath}`)
    }
    const parts = relPath.split(path.sep)
    if (parts.includes('..')) {
      throw new Error(`Path traversal not allowed: ${relPath}`)
    }
    const fullPath = path.resolve(this._allowedRoot, relPath)
    const rel = path.relative(this._allowedRoot, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes workspace: ${relPath}`)
    }
    if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isSymbolicLink()) {
      const realTarget = fs.realpathSync(fullPath)
      const realRel = path.relative(this._allowedRoot, realTarget)
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error(`Symlink points outside workspace: ${relPath} -> ${realTarget}`)
      }
    }
    return fullPath
  }

  invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Record<string, any> {
    const op = params.op ?? 'create'
    let content = params.content ?? ''
    let title = (params.title ?? '').trim()
    const summary = params.summary ?? ''
    const shouldValidate = params.validate !== false
    let autoName: boolean

    // === 容错处理：LLM 可能传错参数组合，这里智能降级 ===
    // 规则1：如果有 path，忽略 auto_name
    // 规则2：如果没有 path 但有 title，强制 auto_name=true（不管 LLM 传的 auto_name 是什么）
    // 规则3：如果有 path 但不是 .md 结尾，自动补 .md
    // 规则4：如果 title 没有，尝试从 content 第一行提取（Markdown # 标题）
    // 规则5：都没有时生成通用标题
    if (params.path && String(params.path).trim()) {
      autoName = false
    } else if (title) {
      autoName = true
    } else {
      // 没 path，没 title：先从 content 尝试提取 # 标题
      if (content) {
        const firstLine = String(content).split('\n').find((l: string) => l.trim())
        if (firstLine) {
          const m = firstLine.match(/^#\s+(.+)$/)
          if (m && m[1]) {
            title = m[1].trim().slice(0, 60)
            logger.info('[doc-writer] Extracted title from Markdown H1: "%s"', title)
          }
        }
      }
      // 降级：无论如何使用 auto_name，标题不行就用 document_日期
      autoName = true
      if (!title) {
        title = `document_${_dateStr()}`
        logger.warning('[doc-writer] No title provided, fallback to auto title: "%s"', title)
      }
    }

    if (!content) {
      return {
        tool: 'doc_writer',
        status: 'error',
        error_code: 'DOC_001',
        data: { message: 'content is required' },
      }
    }

    // 确定文件路径
    let relPath: string
    if (!autoName) {
      // 有 path
      relPath = String(params.path).trim()
    } else {
      // auto_name=true（此时 title 一定有，已在上方容错逻辑中兜底）
      // 如果 title 中已包含日期（如 "xxx日报_2026-08-10" / "xxx日报 2026-8-10 周一"），
      // 不再重复追加日期。兼容非补零格式与日期不在末尾的情况。
      const sanitized = _sanitizeTitle(title)
      const hasDate = /\d{4}-\d{1,2}-\d{1,2}/.test(sanitized)
      relPath = hasDate ? `${sanitized}.md` : `${sanitized}_${_dateStr()}.md`
    }

    // 路径校验
    let fullPath: string
    try {
      fullPath = this._validatePath(relPath)
    } catch (e) {
      return {
        tool: 'doc_writer',
        status: 'error',
        error_code: 'DOC_004',
        data: { message: String(e) },
      }
    }

    // 确保文件名以 .md 结尾
    if (!fullPath.endsWith('.md')) {
      fullPath += '.md'
      relPath += '.md'
    }

    try {
      // 写入文件
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })

      if (op === 'append' && fs.existsSync(fullPath)) {
        fs.appendFileSync(fullPath, '\n\n' + content, 'utf-8')
      } else {
        fs.writeFileSync(fullPath, content, 'utf-8')
      }

      const bytesWritten = Buffer.byteLength(content, 'utf-8')
      const stat = fs.statSync(fullPath)
      const fileName = path.basename(fullPath)

      // 写后校验
      if (shouldValidate) {
        const written = fs.readFileSync(fullPath, 'utf-8')
        if (!written || written.length === 0) {
          return {
            tool: 'doc_writer',
            status: 'error',
            error_code: 'DOC_005',
            data: { message: 'Post-write validation failed: file is empty', path: relPath },
          }
        }
        // 校验写入内容是否包含在文件中（append 模式下文件可能更大）
        if (op === 'create' && written !== content) {
          logger.warning('Post-write validation: content mismatch (written %d vs expected %d bytes)', written.length, content.length)
        }
        logger.info('Post-write validation passed: %s (%d bytes)', fileName, stat.size)
      }

      logger.info('Document created: %s (%d bytes, op=%s)', fileName, stat.size, op)

      return {
        tool: 'doc_writer',
        status: 'success',
        error_code: '',
        data: {
          path: relPath,
          absolute_path: fullPath,
          name: fileName,
          size: stat.size,
          bytes_written: bytesWritten,
          format: 'md',
          operation: op === 'append' ? 'modify' : 'create',
          summary: summary || undefined,
          title: title || undefined,
        },
      }
    } catch (e: any) {
      logger.error('DocWriter error: %s', String(e))
      return {
        tool: 'doc_writer',
        status: 'error',
        error_code: 'DOC_006',
        data: { message: `Failed to write document: ${e}` },
      }
    }
  }
}
