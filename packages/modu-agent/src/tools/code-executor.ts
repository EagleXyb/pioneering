// 对应 Python: components/action/tools/code_executor.py
// P3-12.3.4: 代码执行工具（白名单沙箱 + 子进程隔离）
//
// ⚠️ 沙箱定位：**弱沙箱 + 强审批**。
//     本工具的静态校验是正则/词法黑名单（JS 侧无 Python AST），只能抬高而非
//     杜绝逃逸成本；真正的安全边界依赖人工审批（requiresApproval=true）。
//     中期目标：Python AST 白名单解析；长期目标：nsjail / 容器 / Job Object 隔离。
//
// 安全策略（多层防御）：
//     1. 源码黑名单：拒绝 import / eval / exec / compile / open / __import__ /
//        __getattribute__ 等元编程危险标识符（含字符串传参/朴素拼接形态）
//     2. 子进程隔离：在独立进程中执行，超时强制终止
//     3. 最小环境：仅保留 PATH，禁用用户站点包（-I 模式）
//     4. 资源限制：超时 10s（可配），stdout/stderr 截断 4KB；POSIX 额外注入 rlimit
//
// 需要人工审批（requiresApproval() = true），仅在 HITL 开启时生效。
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { BaseTool } from '../core/interfaces/action.js'
// P0（T-04）: 安全审计事件发布（代码校验拦截）
import { publish_security_audit_event_sync } from '../perception/security/audit.js'

const execFileAsync = promisify(execFile)

// 跨平台 Python 解释器命令解析（缓存结果）
// Windows 下 `python3` 通常不存在，需回退到 `python` 或 `py`
let _resolvedPythonCmd: string | null = null

async function _resolvePythonCommand(): Promise<string> {
  if (_resolvedPythonCmd) return _resolvedPythonCmd
  const candidates =
    process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ['--version'], { timeout: 5000 })
      _resolvedPythonCmd = cmd
      return cmd
    } catch {
      // 尝试下一个候选命令
    }
  }
  // 回退到 python3（Linux/macOS 默认）
  _resolvedPythonCmd = 'python3'
  return _resolvedPythonCmd
}

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
// P0-5：补齐 __getattribute__/__getattr__/__reduce*__/__init_subclass__——
// 这些以"字符串传参 + 方法调用"形式（x.__getattribute__('__class__')）
// 不经由 .attr 字面检查链即可触达真实 import 链，构成系统性逃逸。
const _FORBIDDEN_ATTRS: Set<string> = new Set([
  '__class__', '__bases__', '__subclasses__', '__mro__',
  '__globals__', '__builtins__', '__dict__', '__code__',
  '__module__', '__import__',
  '__getattribute__', '__getattr__',
  '__reduce__', '__reduce_ex__', '__init_subclass__', '__base__',
])

// 禁止的标识符片段（用于检测字符串拼接绕过，对应文档 §2.5 建议2）
// 例如 __import__('o'+'s') 中 'o'+'s' 拼接出 'os'，需检测片段级匹配
// P0-5：元编程 dunder 以字符串形态出现（字面量参数 / 下标访问 / 分片拼接）
// 同样拒绝；启发式宁误报不漏报。
const _FORBIDDEN_FRAGMENTS: Set<string> = new Set([
  '__import__',
  'subprocess',
  'os.system',
  'os.popen',
  'os.exec',
  'os.spawn',
  'shutil.rmtree',
  'pathlib.Path',
  'ctypes.CDLL',
  'pickle.loads',
  'marshal.loads',
  'importlib.import_module',
  '__getattribute__',
  '__getattr__',
  '__reduce_ex__',
  '__reduce__',
  '__init_subclass__',
  '__subclasses__',
  '__class__',
  '__base__',
])

/**
 * 代码校验器：拒绝所有禁止的标识符与属性访问。
 *
 * 对应 Python CodeValidator（ast.NodeVisitor）。
 * JS 无 Python AST 解析器，改用正则 + 词法分析做等价校验：
 *   - 检测 import / from-import 语句
 *   - 检测禁止的标识符名称
 *   - 检测禁止的属性访问
 *   - 检测字符串拼接绕过（对应文档 §2.5 建议2）：
 *       检测代码中所有字符串字面量，拼接后检查是否包含禁止片段
 *       例如 'o'+'s' 拼接为 'os'，'__imp'+'ort__' 拼接为 '__import__'
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

    // 检测字符串拼接绕过（对应文档 §2.5 建议2）
    this._detectStringConcatenation(code)
  }

  /**
   * 检测字符串拼接绕过。
   *
   * 提取代码中所有字符串字面量（单引号/双引号），拼接后检查是否包含禁止片段。
   * 例如：'__imp' + 'ort__' 拼接为 '__import__'，触发拦截。
   *
   * 注意：此为启发式检测，可能存在误报（如代码中合法使用 'os' 字符串），
   * 但安全场景下误报优于漏报。
   */
  private _detectStringConcatenation(code: string): void {
    // 提取所有字符串字面量（简化匹配，覆盖常见引号形式）
    const stringLiterals: string[] = []
    const stringPattern = /(['"])((?:\\.|(?!\1).)*)\1/g
    let m: RegExpExecArray | null
    while ((m = stringPattern.exec(code)) !== null) {
      stringLiterals.push(m[2])
    }

    if (stringLiterals.length === 0) {
      return
    }

    // 拼接所有字符串字面量，检查是否包含禁止片段
    const concatenated = stringLiterals.join('')
    for (const fragment of _FORBIDDEN_FRAGMENTS) {
      if (concatenated.includes(fragment)) {
        this.errors.push(
          `string concatenation detected producing forbidden fragment '${fragment}'`,
        )
      }
    }
  }
}

// P1-14：POSIX 子进程资源限制默认值
const _DEFAULT_RLIMIT_MEMORY_BYTES = 512 * 1024 * 1024 // RLIMIT_AS：512MB 虚拟内存
const _DEFAULT_RLIMIT_CPU_SECONDS = 10                // RLIMIT_CPU：10s CPU 时间

/** P1-14：资源限制参数。 */
export interface CodeExecutorResourceLimits {
  /** RLIMIT_AS 字节数（默认 512MB）。 */
  memoryBytes?: number
  /** RLIMIT_CPU 秒数（默认 10）。 */
  cpuSeconds?: number
}

/**
 * P1-14：生成 POSIX 子进程资源限制前置片段（Python）。
 *
 * 通过标准库 `resource.setrlimit` 对自身进程设置：
 *   - RLIMIT_AS：地址空间上限（内存炸弹如 `'x'*10**10` 触发 MemoryError/被 OOM 杀）；
 *   - RLIMIT_CPU：CPU 时间上限（死循环占满 CPU 时收 SIGXCPU 退出）。
 * Windows 无 resource 模块：片段内置平台守卫自动跳过（文件头注释说明此局限，
 * Windows 侧资源约束仍由 timeout/maxBuffer 提供）。
 *
 * 作为独立 preamble 文件在用户脚本之前执行（不污染用户代码、不经黑名单校验）。
 */
export function buildResourceLimitPreamble(opts: CodeExecutorResourceLimits = {}): string {
  const memoryBytes = opts.memoryBytes ?? _DEFAULT_RLIMIT_MEMORY_BYTES
  const cpuSeconds = opts.cpuSeconds ?? _DEFAULT_RLIMIT_CPU_SECONDS
  return [
    '# -*- coding: utf-8 -*-',
    '# Auto-generated by @modu/agent code-executor (P1-14): POSIX resource limits.',
    '# No-op on Windows (resource module unavailable); timeout/maxBuffer still apply.',
    'import sys as _modu_sys',
    "if _modu_sys.platform != 'win32':",
    '    import resource as _modu_resource',
    `    _modu_resource.setrlimit(_modu_resource.RLIMIT_AS, (${memoryBytes}, ${memoryBytes}))`,
    `    _modu_resource.setrlimit(_modu_resource.RLIMIT_CPU, (${cpuSeconds}, ${cpuSeconds}))`,
    '',
  ].join('\n')
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
      // P0（T-04）: 审计事件 —— 代码校验拦截（补上 code_validation_blocked 的发布者）
      publish_security_audit_event_sync({
        eventType: 'code_validation_blocked',
        decision: 'deny',
        toolName: 'code_executor',
        details: { reason: errorMsg },
      })
      return {
        status: 'error',
        error_code: 'CODE_002',
        data: { message: `Code validation failed: ${errorMsg}` },
      }
    }

    // 2. 子进程隔离执行
    const tmpDir = os.tmpdir()
    const tempPath = path.join(tmpDir, `modu_code_${Date.now()}_${Math.random().toString(36).slice(2)}.py`)
    // preamble 路径/开关需在 try 外声明（try 块的词法绑定对 finally 不可见）
    const preamblePath = path.join(
      tmpDir,
      `modu_code_rl_${Date.now()}_${Math.random().toString(36).slice(2)}.py`,
    )
    let rlimitEnabled = false

    try {
      fs.writeFileSync(tempPath, code, 'utf-8')

      // P1-14：POSIX 下先生成 rlimit preamble 文件并置于用户脚本之前执行；
      // Windows 无 resource 模块，跳过（仅 timeout/maxBuffer 约束）。
      if (process.platform !== 'win32') {
        fs.writeFileSync(
          preamblePath,
          buildResourceLimitPreamble({ cpuSeconds: this._timeout }),
          'utf-8',
        )
        rlimitEnabled = true
      }

      try {
        // 最小环境变量（对应 Python env = {"PATH": ...}）
        const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin' }

        const pythonArgs = ['-I']
        if (rlimitEnabled) pythonArgs.push(preamblePath)
        pythonArgs.push(tempPath)

        const pythonCmd = await _resolvePythonCommand()
        const { stdout, stderr } = await execFileAsync(pythonCmd, pythonArgs, {
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
      for (const f of rlimitEnabled ? [preamblePath, tempPath] : [tempPath]) {
        try {
          fs.unlinkSync(f)
        } catch {
          // 忽略清理失败
        }
      }
    }
  }
}
