// 对应 Python: components/action/tools/calculator.py
// CalculatorTool：数学表达式计算工具（白名单字符 + 安全求值）
import { BaseTool } from '../core/interfaces/action.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[calculator] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[calculator] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[calculator] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[calculator] ${msg}`, ...args),
}

// 仅允许数字、+-*/() 和空白
const _EXPRESSION_PATTERN = /^[0-9+\-*/\s().]+$/

/**
 * 计算器工具。
 * 对应 Python CalculatorTool。
 *
 * 安全策略：白名单字符校验 + 受限求值（仅数字和算术运算符）。
 */
export class CalculatorTool extends BaseTool {
  name(): string {
    return 'calculator'
  }

  description(): string {
    return '计算数学表达式，仅支持加减乘除和括号运算'
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '数学表达式（仅支持+-*/和括号）',
          pattern: '^[0-9+\\-*/\\\\s().]+$',
        },
      },
      required: ['expression'],
    }
  }

  invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Record<string, any> {
    const expression = params.expression ?? ''

    if (typeof expression !== 'string' || !expression.trim()) {
      return {
        status: 'error',
        error_code: 'TOOL_001',
        data: { message: '表达式不能为空' },
      }
    }

    const trimmed = expression.trim()

    if (!_EXPRESSION_PATTERN.test(trimmed)) {
      return {
        status: 'error',
        error_code: 'TOOL_001',
        data: { message: '非法表达式，仅允许数字和+-*/()' },
      }
    }

    try {
      const result = CalculatorTool._safeEval(trimmed)
      return {
        status: 'success',
        error_code: '',
        data: { result, expression: trimmed },
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('division')) {
        return {
          status: 'error',
          error_code: 'TOOL_002',
          data: { message: '除零错误' },
        }
      }
      logger.error('CalculatorTool eval error: %s - %s', trimmed, String(e))
      return {
        status: 'error',
        error_code: 'TOOL_002',
        data: { message: `计算错误: ${e}` },
      }
    }
  }

  /**
   * 安全求值：仅允许数字和算术运算符。
   * 对应 Python _safe_eval（compile + eval with empty __builtins__）。
   *
   * TS 版使用手写递归下降解析器替代 Python 的 eval，避免代码注入风险。
   */
  private static _safeEval(expression: string): number {
    const allowedChars = new Set('0123456789+-*/(). ')
    for (const c of expression) {
      if (!allowedChars.has(c)) {
        throw new Error(`Disallowed character in expression: ${expression}`)
      }
    }

    const parser = new _MathParser(expression)
    const result = parser.parseExpression()
    parser.expectEnd()
    return result
  }
}

/**
 * 递归下降数学表达式解析器。
 *
 * 文法：
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := number | '(' expression ')' | ('+' | '-') factor
 *
 * 除零时抛出含 "division" 的错误（与 Python ZeroDivisionError 分支对应）。
 */
class _MathParser {
  private _input: string
  private _pos: number = 0

  constructor(input: string) {
    this._input = input
  }

  parseExpression(): number {
    let left = this.parseTerm()
    while (true) {
      this.skipWhitespace()
      const op = this.peek()
      if (op === '+') {
        this._pos++
        left = left + this.parseTerm()
      } else if (op === '-') {
        this._pos++
        left = left - this.parseTerm()
      } else {
        break
      }
    }
    return left
  }

  private parseTerm(): number {
    let left = this.parseFactor()
    while (true) {
      this.skipWhitespace()
      const op = this.peek()
      if (op === '*') {
        this._pos++
        left = left * this.parseFactor()
      } else if (op === '/') {
        this._pos++
        const right = this.parseFactor()
        if (right === 0) {
          throw new Error('division by zero')
        }
        left = left / right
      } else {
        break
      }
    }
    return left
  }

  private parseFactor(): number {
    this.skipWhitespace()
    const ch = this.peek()
    if (ch === '+') {
      this._pos++
      return this.parseFactor()
    }
    if (ch === '-') {
      this._pos++
      return -this.parseFactor()
    }
    if (ch === '(') {
      this._pos++
      const val = this.parseExpression()
      this.skipWhitespace()
      if (this.peek() !== ')') {
        throw new Error('Expected closing parenthesis')
      }
      this._pos++
      return val
    }
    return this.parseNumber()
  }

  private parseNumber(): number {
    this.skipWhitespace()
    const start = this._pos
    while (this._pos < this._input.length) {
      const c = this._input[this._pos]
      if ((c >= '0' && c <= '9') || c === '.') {
        this._pos++
      } else {
        break
      }
    }
    if (start === this._pos) {
      throw new Error(`Expected number at position ${this._pos}`)
    }
    return parseFloat(this._input.slice(start, this._pos))
  }

  private skipWhitespace(): void {
    while (this._pos < this._input.length && /\s/.test(this._input[this._pos])) {
      this._pos++
    }
  }

  private peek(): string {
    return this._pos < this._input.length ? this._input[this._pos] : ''
  }

  expectEnd(): void {
    this.skipWhitespace()
    if (this._pos < this._input.length) {
      throw new Error(`Unexpected character at position ${this._pos}: ${this._input[this._pos]}`)
    }
  }
}
