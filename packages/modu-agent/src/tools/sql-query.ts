// 对应 Python: components/action/tools/sql_query.py
// P3-12.3.4: SQL 查询工具（参数化 + 只读限制）
//
// 安全策略：
//     1. 仅允许 SELECT 语句（正则阻止 DROP/DELETE/INSERT/UPDATE/ALTER）
//     2. 强制参数化查询（? 占位符），杜绝 SQL 注入
//     3. 默认只读连接
//     4. 表名白名单（可选）
//     5. 行数限制（默认 1000 行）
//
// 需要人工审批（requiresApproval() = true）。
//
// 注：Python 版依赖 sqlite3 标准库；TS 版动态导入 better-sqlite3（需安装），
// 未安装时返回 HTTP_003 等价的依赖缺失错误。
import { BaseTool } from '../core/interfaces/action.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[sql-query] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[sql-query] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[sql-query] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[sql-query] ${msg}`, ...args),
}

// 危险 SQL 关键词（仅允许 SELECT）
const _FORBIDDEN_SQL_KEYWORDS = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE)\b/i

// SELECT 语句前缀校验
const _SELECT_PREFIX = /^\s*SELECT\b/i

/**
 * P3-12.3.4: SQL 查询工具。
 *
 * 对应 Python SqlQueryTool。
 *
 * 支持 SQLite 数据库的只读查询，强制参数化防注入。
 *
 * @param dbPath SQLite 数据库文件路径（null=内存数据库）
 * @param maxRows 最大返回行数（默认 1000）
 * @param allowedTables 允许查询的表名白名单（null=不限制）
 */
export class SqlQueryTool extends BaseTool {
  private _dbPath: string
  private _maxRows: number
  private _allowedTables: Set<string> | null

  constructor(
    dbPath?: string | null,
    maxRows: number = 1000,
    allowedTables?: string[] | null,
  ) {
    super()
    this._dbPath = dbPath ? dbPath : ':memory:'
    this._maxRows = maxRows
    this._allowedTables = allowedTables ? new Set(allowedTables) : null
  }

  name(): string {
    return 'sql_query'
  }

  description(): string {
    return (
      '执行只读 SQL 查询（SELECT only），支持参数化查询防注入；' +
      '禁止 DROP/DELETE/INSERT/UPDATE 等修改操作'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL 查询语句（仅 SELECT，参数用 ? 占位）',
        },
        params: {
          type: 'array',
          description: '参数化查询的参数列表（对应 ? 占位符）',
          items: {},
        },
      },
      required: ['query'],
    }
  }

  requiresApproval(): boolean {
    return true
  }

  onApprovalRejected(params: Record<string, any>): Record<string, any> {
    const query = params.query ?? ''
    return {
      status: 'error',
      error_code: 'TOOL_APPROVAL_REJECTED',
      data: {
        message: 'SQL query was rejected by the human reviewer',
        query_preview: query.length > 120 ? query.slice(0, 120) + '...' : query,
      },
    }
  }

  /**
   * 校验 SQL 语句安全。
   * 对应 Python _validate_query。
   *
   * @returns [isValid, errorMessage]
   */
  private _validateQuery(query: string): [boolean, string] {
    if (!query || !query.trim()) {
      return [false, 'Query is empty']
    }

    // 必须以 SELECT 开头
    if (!_SELECT_PREFIX.test(query)) {
      return [false, 'Only SELECT statements are allowed']
    }

    // 检查禁止的关键词（DML/DDL）
    const match = query.match(_FORBIDDEN_SQL_KEYWORDS)
    if (match) {
      return [false, `Forbidden SQL keyword: ${match[0]}`]
    }

    // 检查分号（防多语句注入）
    const stripped = query.trim().replace(/;+$/, '')
    if (stripped.includes(';')) {
      return [false, 'Multiple statements not allowed (semicolons forbidden)']
    }

    // 检查注释（防通过注释绕过校验）
    if (query.includes('--') || query.includes('/*')) {
      return [false, 'SQL comments not allowed']
    }

    // 表名白名单检查
    if (this._allowedTables !== null) {
      // 简化提取 FROM/JOIN 后的表名
      const tableMatches = query.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)
      for (const m of tableMatches) {
        const table = m[1]
        if (!this._allowedTables.has(table)) {
          return [false, `Table '${table}' not in allowed list`
          ]
        }
      }
    }

    return [true, '']
  }

  async invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const query = params.query ?? ''
    let queryParams: any[] = params.params ?? []

    if (queryParams === null) {
      queryParams = []
    }

    // 1. SQL 校验
    const [isValid, errorMsg] = this._validateQuery(query)
    if (!isValid) {
      logger.warning('SqlQuery rejected: %s', errorMsg)
      return {
        status: 'error',
        error_code: 'SQL_001',
        data: { message: errorMsg },
      }
    }

    // 2. 参数类型校验
    if (!Array.isArray(queryParams)) {
      return {
        status: 'error',
        error_code: 'SQL_002',
        data: { message: 'params must be a list' },
      }
    }

    // 3. 执行查询（动态导入 better-sqlite3）
    let Database: any
    try {
      // 动态导入避免硬依赖；better-sqlite3 需额外安装
      const mod = await import('better-sqlite3')
      Database = mod.default ?? mod
    } catch (e) {
      logger.error('SqlQuery: better-sqlite3 not available: %s', String(e))
      return {
        status: 'error',
        error_code: 'SQL_003',
        data: { message: `better-sqlite3 not available: ${e}` },
      }
    }

    let db: any
    try {
      // SQLite 连接
      const dbPath = this._dbPath === ':memory:' ? ':memory:' : this._dbPath
      db = new Database(dbPath)

      // 强制只读模式（SQLite pragma）
      try {
        db.pragma('query_only = ON')
      } catch {
        // 某些 SQLite 版本不支持，忽略
      }

      const stmt = db.prepare(query)
      const rows = stmt.all(...queryParams) as any[]

      // 限制返回行数
      const limitedRows = rows.slice(0, this._maxRows)
      const columns: string[] = limitedRows.length > 0 ? Object.keys(limitedRows[0]) : []

      return {
        status: 'success',
        error_code: '',
        data: {
          columns,
          rows: limitedRows,
          row_count: limitedRows.length,
          truncated: limitedRows.length >= this._maxRows,
        },
      }
    } catch (e: any) {
      // Python: except sqlite3.Error as e → except Exception as e
      // TS 只允许单个 catch，通过 error.code 区分 SQLite 错误与意外错误
      if (e && typeof e.code === 'string' && e.code.startsWith('SQLITE')) {
        // better-sqlite3 抛出 SqliteError（code 以 SQLITE 开头）
        logger.warning('SqlQuery error: %s', String(e))
        return {
          status: 'error',
          error_code: 'SQL_003',
          data: { message: `SQL error: ${e}` },
        }
      }
      logger.error('SqlQuery unexpected error: %s', String(e))
      return {
        status: 'error',
        error_code: 'SQL_004',
        data: { message: `Unexpected error: ${e}` },
      }
    } finally {
      if (db) {
        try {
          db.close()
        } catch {
          // 忽略关闭错误
        }
      }
    }
  }
}
