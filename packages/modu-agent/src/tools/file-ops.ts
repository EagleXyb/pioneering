// 对应 Python: components/action/tools/file_ops.py
// P3-12.3.4: 文件操作工具（路径校验 + 工作目录约束）
//
// 安全策略：
//     1. 工作目录约束：所有路径必须位于 allowed_root 下
//     2. 路径穿越检测：拒绝 .. 与绝对路径
//     3. 符号链接检测：拒绝指向 allowed_root 外的 symlink
//     4. 写操作需人工审批（requiresApproval=true）
//
// allowed_root 通过环境变量 MODU_FILE_OPS_ROOT 或参数指定，默认为系统临时目录。
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BaseTool } from '../core/interfaces/action.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[file-ops] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[file-ops] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[file-ops] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[file-ops] ${msg}`, ...args),
}

/**
 * P3-12.3.4: 文件操作工具。
 *
 * 对应 Python FileOpsTool。
 *
 * 支持 read / write / list / delete 四种操作，所有路径必须位于 allowed_root 下。
 *
 * 写操作（write / delete）需要人工审批（仅在 HITL 开启时生效）。
 */
export class FileOpsTool extends BaseTool {
  private _allowedRoot: string

  constructor(allowedRoot?: string | null) {
    super()
    if (allowedRoot) {
      this._allowedRoot = path.resolve(allowedRoot)
    } else {
      // 默认使用环境变量或系统临时目录
      const envRoot = process.env.MODU_FILE_OPS_ROOT
      if (envRoot) {
        this._allowedRoot = path.resolve(envRoot)
      } else {
        this._allowedRoot = path.resolve(os.tmpdir(), 'modu_workspace')
      }
    }
    // 确保目录存在
    fs.mkdirSync(this._allowedRoot, { recursive: true })
  }

  name(): string {
    return 'file_ops'
  }

  description(): string {
    return (
      '在工作目录内读写文件，支持 read/write/list/delete 操作；' +
      '禁止路径穿越（..）与符号链接到工作目录外'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          description: '操作类型：read/write/list/delete',
          enum: ['read', 'write', 'list', 'delete'],
        },
        path: {
          type: 'string',
          description: '相对工作目录的文件路径（禁用 .. 与绝对路径）',
        },
        content: {
          type: 'string',
          description: 'write 操作时的文件内容',
        },
      },
      required: ['op', 'path'],
    }
  }

  requiresApproval(): boolean {
    return true
  }

  onApprovalRejected(params: Record<string, any>): Record<string, any> {
    const op = params.op ?? ''
    const p = params.path ?? ''
    return {
      status: 'error',
      error_code: 'TOOL_APPROVAL_REJECTED',
      data: {
        message: `File operation '${op}' on '${p}' was rejected by reviewer`,
      },
    }
  }

  /**
   * 校验路径是否在 allowed_root 内，返回绝对路径。
   *
   * 对应 Python _validate_path。
   *
   * @param relPath 相对工作目录的路径
   * @returns 校验通过的绝对路径
   * @throws Error 路径穿越或符号链接指向外部
   */
  private _validatePath(relPath: string): string {
    if (!relPath) {
      throw new Error('Path is empty')
    }

    // 拒绝绝对路径与盘符前缀（Windows）
    if (path.isAbsolute(relPath) || /^[CDEF]:/i.test(relPath.slice(0, 2))) {
      throw new Error(`Absolute path not allowed: ${relPath}`)
    }

    // 拒绝 .. 路径穿越
    const parts = relPath.split(path.sep)
    if (parts.includes('..')) {
      throw new Error(`Path traversal not allowed: ${relPath}`)
    }

    // 解析为绝对路径并校验在 allowed_root 内
    const fullPath = path.resolve(this._allowedRoot, relPath)
    const rel = path.relative(this._allowedRoot, fullPath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path escapes workspace: ${relPath}`)
    }

    // 检查符号链接（如果文件已存在且为 symlink）
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
    const op = params.op ?? ''
    const relPath = params.path ?? ''
    const content = params.content ?? ''

    if (!['read', 'write', 'list', 'delete'].includes(op)) {
      return {
        status: 'error',
        error_code: 'FILE_001',
        data: { message: `Invalid op: ${op}` },
      }
    }

    let fullPath: string
    try {
      fullPath = this._validatePath(relPath)
    } catch (e) {
      return {
        status: 'error',
        error_code: 'FILE_002',
        data: { message: String(e) },
      }
    }

    try {
      if (op === 'read') {
        if (!fs.existsSync(fullPath)) {
          return {
            status: 'error',
            error_code: 'FILE_003',
            data: { message: `File not found: ${relPath}` },
          }
        }
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) {
          return {
            status: 'error',
            error_code: 'FILE_004',
            data: { message: `Not a file: ${relPath}` },
          }
        }
        // 限制读取大小 256KB
        const text = fs.readFileSync(fullPath, 'utf-8').slice(0, 262144)
        return {
          status: 'success',
          error_code: '',
          data: {
            content: text,
            path: relPath,
            size: stat.size,
          },
        }
      } else if (op === 'write') {
        if (typeof content !== 'string') {
          return {
            status: 'error',
            error_code: 'FILE_005',
            data: { message: 'content must be a string' },
          }
        }
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content, 'utf-8')
        return {
          status: 'success',
          error_code: '',
          data: {
            path: relPath,
            bytes_written: Buffer.byteLength(content, 'utf-8'),
          },
        }
      } else if (op === 'list') {
        if (!fs.existsSync(fullPath)) {
          return {
            status: 'error',
            error_code: 'FILE_003',
            data: { message: `Path not found: ${relPath}` },
          }
        }
        const stat = fs.statSync(fullPath)
        if (!stat.isDirectory()) {
          return {
            status: 'error',
            error_code: 'FILE_006',
            data: { message: `Not a directory: ${relPath}` },
          }
        }
        const entries = fs.readdirSync(fullPath).sort().map((name) => {
          const entryPath = path.join(fullPath, name)
          const entryStat = fs.statSync(entryPath)
          return {
            name,
            type: entryStat.isDirectory() ? 'dir' : 'file',
            size: entryStat.isFile() ? entryStat.size : 0,
          }
        })
        return {
          status: 'success',
          error_code: '',
          data: { path: relPath, entries },
        }
      } else if (op === 'delete') {
        if (!fs.existsSync(fullPath)) {
          return {
            status: 'error',
            error_code: 'FILE_003',
            data: { message: `File not found: ${relPath}` },
          }
        }
        const stat = fs.statSync(fullPath)
        // 仅允许删除文件，不允许删除目录
        if (stat.isDirectory()) {
          return {
            status: 'error',
            error_code: 'FILE_007',
            data: { message: `Cannot delete directory: ${relPath}` },
          }
        }
        fs.unlinkSync(fullPath)
        return {
          status: 'success',
          error_code: '',
          data: { path: relPath, deleted: true },
        }
      }
    } catch (e: any) {
      if (e && typeof e.code === 'string' && e.code.startsWith('ENOENT')) {
        logger.error('FileOps error: %s', String(e))
        return {
          status: 'error',
          error_code: 'FILE_008',
          data: { message: `OS error: ${e}` },
        }
      }
      logger.error('FileOps unexpected error: %s', String(e))
      return {
        status: 'error',
        error_code: 'FILE_009',
        data: { message: `Unexpected error: ${e}` },
      }
    }

    // 不可达
    return {
      status: 'error',
      error_code: 'FILE_001',
      data: { message: `Invalid op: ${op}` },
    }
  }

  /** 工作目录根路径。 */
  get allowedRoot(): string {
    return this._allowedRoot
  }
}
