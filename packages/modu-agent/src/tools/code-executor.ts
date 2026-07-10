// 对应 Python: components/action/tools/code_executor.py
// P3-12.3.4: 代码执行工具（白名单沙箱 + 子进程隔离）
//
// 安全策略（多层防御）：
//     1. 源码白名单：拒绝 import / eval / exec / compile / open / __import__ 等危险标识符
//     2. 子进程隔离：在独立进程中执行，超时强制终止
//     3. 最小环境：仅保留 PATH，禁用用户站点包（-I 模式）
//     4. 资源限制：超时 10s（可配），stdout/stderr 截断 4KB
//
// 需要人工审批（requiresApproval() = true），仅在 HITL 开启时生效。
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { BaseTool } from '../core/interfaces/action.js'

const execFileAsync = promisify(execFile)

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[code-executor] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[code-executor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[code-executor] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[code-executor] ${msg}`, ...args),
}

// 禁止的标识符名称（即使语法允许，名称危险也拒绝）
const _FORBIDDEN_NAMES: Set<string> = new Set([
  '__import__', 'eval', 'exec', 'compile', 'open', 'input',
  'globals', 'locals', 'vars', 'dir', 'getattr', 'setattr',
  'delattr', '__builtins__', 'subprocess', 'os', 'sys',
  'shutil', 'pathlib', 'ctypes', 'pickle', 'marshal',
  'importlib',
])

// 禁止的属性访问名（防止 .__class__.__bases__ 等元类逃逸）
const _FORBIDDEN_ATTRS: Set<string> = new Set([
  '__class__', '__bases__', '__subclasses__', '__mro__',
  '__globals__', '__builtins__', '__dict__', '__code__',
  '__module__', '__import__',
])

/**
 * 代码校验器：拒绝所有禁止的标识符与属性访问。
 *
 * 对应 Python CodeValidator（ast.NodeVisitor）。
 * JS 无 Python AST 解析器，改用正则 + 词法分析做等价校验：
 *   - 检测 import / from-import 语句
 *   - 检测禁止的标识符名称
 *   - 检测禁止的属性访问
 */
class CodeValidator {
  errors: string[] = []

  validate(code: string): void {
    // 检测 import 语句
    if (/^\s*import\s+/m.test(code)) {
      this.errors.push('import statements are forbidden')
    }
    if (/^\s*from\s+\S+\s+import/m.test(code)) {
      this.errors.push('from-import statements are forbidden')
    }

    // 检测禁止的标识符名称（词边界匹配）
    for (const name of _FORBIDDEN_NAMES) {
      // 匹配作为独立标识符使用（前导非字母数字/下划线，后随非字母数字/下划线或行尾）
      const pattern = new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`)
      if (pattern.test(code)) {
        this.errors.push(`name '${name}' is forbidden`)
      }
    }

    // 检测禁止的属性访问（.attr 形式）
    for (const attr of _FORBIDDEN_ATTRS) {
      const pattern = new RegExp(`\\.${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`)
      if (pattern.test(code)) {
        this.errors.push(`attribute '${attr}' is forbidden`)
      }
    }
  }
}

/**
 * 校验代码是否符合白名单规则。
 *
 * 对应 Python _validate_code。
 *
 * @param code 待校验的 Python 代码字符串
 * @returns [isValid, errorMessage]：isValid=true 时 errorMessage 为空字符串
 */
function _validateCode(code: string): [boolean, string] {
  const validator = new CodeValidator()
  validator.validate(code)

  if (validator.errors.length > 0) {
    return [false, validator.errors.slice(0, 3).join('; ')]
  }

  return [true, '']
}

/**
 * P3-12.3.4: 代码执行工具。
 *
 * 对应 Python CodeExecutorTool。
 *
 * 通过白名单校验 + 子进程隔离执行用户提交的 Python 代码，
 * 防止沙箱逃逸（import / eval / __class__.__bases__ 等）。
 *
 * 该工具默认 requiresApproval() = true，仅在 HITL 关闭或审批通过时执行。
 *
 * 注：Python 版使用 ast 模块做 AST 白名单校验；JS 版无 Python AST 解析器，
 * 改用正则 + 词法分析做等价校验（检测 import 语句、禁止标识符、禁止属性访问）。
 * 子进程执行通过 child_process 调用 python3 解释器。
 */
export class CodeExecutorTool extends BaseTool {
  private _timeout: number

  constructor(timeoutSeconds: number = 10) {
    super()
    this._timeout = timeoutSeconds
  }

  name(): string {
    return 'code_executor'
  }

  description(): string {
    return (
      '执行 Python 代码（沙箱隔离），支持纯计算、字符串处理、列表/字典操作；' +
      '禁止 import、文件 IO、网络访问、子进程调用'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '待执行的 Python 代码（禁用 import/eval/exec/open）',
        },
      },
      required: ['code'],
    }
  }

  requiresApproval(): boolean {
    return true
  }

  onApprovalRejected(params: Record<string, any>): Record<string, any> {
    const code = params.code ?? ''
    return {
      status: 'error',
      error_code: 'TOOL_APPROVAL_REJECTED',
      data: {
        message: 'Code execution was rejected by the human reviewer',
        code_preview: code.length > 80 ? code.slice(0, 80) + '...' : code,
      },
    }
  }

  async invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const code = params.code ?? ''

    if (typeof code !== 'string' || !code.trim()) {
      return {
        status: 'error',
        error_code: 'CODE_001',
        data: { message: 'Code is empty' },
      }
    }

    // 1. 白名单校验
    const [isValid, errorMsg] = _validateCode(code)
    if (!isValid) {
      logger.warning('CodeExecutor rejected code: %s', errorMsg)
      return {
        status: 'error',
        error_code: 'CODE_002',
        data: { message: `Code validation failed: ${errorMsg}` },
      }
    }

    // 2. 子进程隔离执行
    const tmpDir = os.tmpdir()
    const tempPath = path.join(tmpDir, `modu_code_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)

    try {
      fs.writeFileSync(tempPath, code, 'utf-8')

      try {
        // 最小环境变量（对应 Python env = {"PATH": ...}）
        const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin' }

        const { stdout, stderr } = await execFileAsync('python3', ['-I', tempPath], {
          timeout: this._timeout * 1000,
          env,
          maxBuffer: 1024 * 64, // 64KB 限制
        })

        // 截断输出避免内存爆炸
        const out = (stdout ?? '').slice(0, 4096)
        const err = (stderr ?? '').slice(0, 4096)

        return {
          status: 'success',
          error_code: '',
          data: {
            stdout: out,
            stderr: err,
            returncode: 0,
          },
        }
      } catch (e: any) {
        // execFile 在非零退出码时抛出错误
        if (e.killed) {
          logger.warning('CodeExecutor timeout after %ds', this._timeout)
          return {
            status: 'error',
            error_code: 'CODE_004',
            data: { message: `Execution timeout after ${this._timeout}s` },
          }
        }
        const stdout = (e.stdout ?? '').slice(0, 4096)
        const stderr = (e.stderr ?? '').slice(0, 4096)
        const returncode = e.code ?? 1
        if (returncode !== 0) {
          return {
            status: 'error',
            error_code: 'CODE_003',
            data: {
              stdout,
              stderr,
              returncode,
              message: `Process exited with code ${returncode}`,
            },
          }
        }
        logger.error('CodeExecutor error: %s', String(e))
        return {
          status: 'error',
          error_code: 'CODE_005',
          data: { message: `Execution failed: ${e}` },
        }
      }
    } finally {
      try {
        fs.unlinkSync(tempPath)
      } catch {
        // 忽略清理失败
      }
    }
  }
}
