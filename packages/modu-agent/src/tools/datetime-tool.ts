// 对应 Python: components/action/tools/datetime_tool.py
// P3-12.3.4: 时间日期工具（纯计算，无风险）
//
// 提供时间获取、格式化、时区转换、日期解析等能力，所有操作为纯计算，
// 不涉及 IO / 网络 / 文件，无需人工审批。
import { BaseTool } from '../core/interfaces/action.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[datetime] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[datetime] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[datetime] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[datetime] ${msg}`, ...args),
}

// 常见时区偏移（UTC 偏移小时数）
const _TIMEZONE_OFFSETS: Record<string, number> = {
  UTC: 0.0,
  GMT: 0.0,
  CST: 8.0,    // China Standard Time
  CTT: 8.0,    // China Time
  EST: -5.0,   // Eastern Standard Time
  PST: -8.0,   // Pacific Standard Time
  JST: 9.0,    // Japan Standard Time
  IST: 5.5,    // India Standard Time
  BST: 1.0,    // British Summer Time
  CET: 1.0,    // Central European Time
  EET: 2.0,    // Eastern European Time
}

/**
 * P3-12.3.4: 时间日期工具。
 *
 * 对应 Python DateTimeTool。
 *
 * 支持 now / format / parse / convert 操作。
 */
export class DateTimeTool extends BaseTool {
  name(): string {
    return 'datetime'
  }

  description(): string {
    return (
      '时间日期工具：获取当前时间、格式化、时区转换、日期解析；' +
      '支持 now/format/parse/convert 操作'
    )
  }

  parametersSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          description: '操作类型：now/format/parse/convert',
          enum: ['now', 'format', 'parse', 'convert'],
        },
        timezone: {
          type: 'string',
          description: '时区名称（CST/UTC/EST/PST/JST 等）',
        },
        datetime_str: {
          type: 'string',
          description: 'parse 操作的输入时间字符串',
        },
        format_str: {
          type: 'string',
          description: 'strftime 格式字符串（默认 %Y-%m-%d %H:%M:%S）',
        },
        source_timezone: {
          type: 'string',
          description: 'convert 操作的源时区',
        },
        target_timezone: {
          type: 'string',
          description: 'convert 操作的目标时区',
        },
      },
      required: ['op'],
    }
  }

  // P4 Plan-Execute: 声明本工具提供实时/外部数据（对应文档 §4.1 建议7）
  // now/convert 操作返回系统实时时钟，Planner 据此推断 step.requires_tool=true
  providesRealtimeData(): boolean {
    return true
  }

  invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Record<string, any> {
    const op = params.op ?? ''

    try {
      if (op === 'now') {
        return this._now(params)
      } else if (op === 'format') {
        return this._format(params)
      } else if (op === 'parse') {
        return this._parse(params)
      } else if (op === 'convert') {
        return this._convert(params)
      } else {
        return {
          status: 'error',
          error_code: 'DT_001',
          data: { message: `Unknown op: ${op}` },
        }
      }
    } catch (e) {
      logger.error('DateTimeTool error: %s', String(e))
      return {
        status: 'error',
        error_code: 'DT_002',
        data: { message: String(e) },
      }
    }
  }

  /**
   * 根据时区名称获取 UTC 偏移小时数。
   * 对应 Python _get_tz_offset（返回 timedelta，此处返回小时数）。
   */
  private _getTzOffsetHours(tzName: string): number | null {
    if (!tzName) {
      return null
    }
    const offset = _TIMEZONE_OFFSETS[tzName.toUpperCase()]
    if (offset === undefined) {
      return null
    }
    return offset
  }

  /**
   * strftime 等价格式化（支持 %Y %m %d %H %M %S %A 等常见占位符）。
   */
  private _strftime(date: Date, formatStr: string, utc: boolean = false): string {
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const pad = (n: number, len: number = 2) => String(n).padStart(len, '0')
    // utc=true：按 UTC 字段读取。用于「epoch + 时区偏移」得到的挂钟时间对象，
    // 避免再次叠加宿主机本地偏移（原实现在非 UTC 宿主机上结果偏移数小时）。
    const year = utc ? date.getUTCFullYear() : date.getFullYear()
    const month = utc ? date.getUTCMonth() : date.getMonth()
    const day = utc ? date.getUTCDate() : date.getDate()
    const hours = utc ? date.getUTCHours() : date.getHours()
    const minutes = utc ? date.getUTCMinutes() : date.getMinutes()
    const seconds = utc ? date.getUTCSeconds() : date.getSeconds()
    const weekday = utc ? date.getUTCDay() : date.getDay()

    let result = formatStr
      .replace(/%Y/g, String(year))
      .replace(/%m/g, pad(month + 1))
      .replace(/%d/g, pad(day))
      .replace(/%H/g, pad(hours))
      .replace(/%M/g, pad(minutes))
      .replace(/%S/g, pad(seconds))
      .replace(/%A/g, weekdays[weekday])

    return result
  }

  /**
   * 生成 ISO8601 风格的挂钟时间字符串（不含时区后缀）。
   *
   * 入参 date 为「epoch + 目标时区偏移」构造的对象，故全部使用 UTC getter 读取。
   */
  private _toWallClockIso(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
      `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    )
  }

  private _now(params: Record<string, any>): Record<string, any> {
    const tzName = params.timezone ?? 'UTC'
    const offsetHours = this._getTzOffsetHours(tzName)
    if (offsetHours === null) {
      return {
        status: 'error',
        error_code: 'DT_003',
        data: { message: `Unknown timezone: ${tzName}` },
      }
    }
    // 修复（时区计算错误）：原实现先加 now.getTimezoneOffset() 把 epoch 平移成
    // "本地挂钟伪装 epoch"，导致非 UTC 宿主机上 unix_timestamp 与 iso 偏差
    // getTimezoneOffset()（东八区差 8 小时）。
    //   - unix_timestamp 与时区无关，必须直接取 epoch 秒数
    //   - 目标时区挂钟时间 = epoch + 目标偏移，并用 UTC getter 读取字段
    const now = new Date()
    const epochMs = now.getTime()
    const tzDate = new Date(epochMs + offsetHours * 3600000)
    const formatStr = params.format_str ?? '%Y-%m-%d %H:%M:%S'
    return {
      status: 'success',
      error_code: '',
      data: {
        datetime: this._strftime(tzDate, formatStr, true),
        iso: this._toWallClockIso(tzDate),
        timezone: tzName,
        unix_timestamp: Math.floor(epochMs / 1000),
      },
    }
  }

  private _format(params: Record<string, any>): Record<string, any> {
    const datetimeStr = params.datetime_str ?? ''
    const formatStr = params.format_str ?? '%Y-%m-%d %H:%M:%S'
    if (!datetimeStr) {
      return {
        status: 'error',
        error_code: 'DT_004',
        data: { message: 'datetime_str is required for format op' },
      }
    }
    // 尝试解析输入
    const dt = this._parseDatetime(datetimeStr)
    if (dt === null) {
      return {
        status: 'error',
        error_code: 'DT_005',
        data: { message: `Cannot parse datetime: ${datetimeStr}` },
      }
    }
    return {
      status: 'success',
      error_code: '',
      data: {
        formatted: this._strftime(dt, formatStr),
        iso: dt.toISOString().replace(/\.\d{3}Z$/, ''),
      },
    }
  }

  private _parse(params: Record<string, any>): Record<string, any> {
    const datetimeStr = params.datetime_str ?? ''
    if (!datetimeStr) {
      return {
        status: 'error',
        error_code: 'DT_004',
        data: { message: 'datetime_str is required for parse op' },
      }
    }
    const dt = this._parseDatetime(datetimeStr)
    if (dt === null) {
      return {
        status: 'error',
        error_code: 'DT_005',
        data: { message: `Cannot parse datetime: ${datetimeStr}` },
      }
    }
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return {
      status: 'success',
      error_code: '',
      data: {
        iso: dt.toISOString().replace(/\.\d{3}Z$/, ''),
        year: dt.getFullYear(),
        month: dt.getMonth() + 1,
        day: dt.getDate(),
        hour: dt.getHours(),
        minute: dt.getMinutes(),
        second: dt.getSeconds(),
        weekday: weekdays[dt.getDay()],
        unix_timestamp: Math.floor(dt.getTime() / 1000),
      },
    }
  }

  private _convert(params: Record<string, any>): Record<string, any> {
    const datetimeStr = params.datetime_str ?? ''
    const srcTz = params.source_timezone ?? 'UTC'
    const tgtTz = params.target_timezone ?? 'UTC'
    const formatStr = params.format_str ?? '%Y-%m-%d %H:%M:%S'

    if (!datetimeStr) {
      return {
        status: 'error',
        error_code: 'DT_004',
        data: { message: 'datetime_str is required for convert op' },
      }
    }

    const srcOffset = this._getTzOffsetHours(srcTz)
    const tgtOffset = this._getTzOffsetHours(tgtTz)
    if (srcOffset === null) {
      return {
        status: 'error',
        error_code: 'DT_003',
        data: { message: `Unknown source timezone: ${srcTz}` },
      }
    }
    if (tgtOffset === null) {
      return {
        status: 'error',
        error_code: 'DT_003',
        data: { message: `Unknown target timezone: ${tgtTz}` },
      }
    }

    // 解析输入时间（视为源时区本地时间）
    const dt = this._parseDatetime(datetimeStr)
    if (dt === null) {
      return {
        status: 'error',
        error_code: 'DT_005',
        data: { message: `Cannot parse datetime: ${datetimeStr}` },
      }
    }

    // 转换：源时区 → UTC → 目标时区
    // dt 视为源时区本地时间，减去源偏移得到 UTC，加上目标偏移得到目标本地时间
    const utcMs = dt.getTime() - srcOffset * 3600000
    const tgtDate = new Date(utcMs + tgtOffset * 3600000)

    return {
      status: 'success',
      error_code: '',
      data: {
        source_datetime: this._strftime(dt, formatStr),
        source_timezone: srcTz,
        target_datetime: this._strftime(tgtDate, formatStr, true),
        target_timezone: tgtTz,
        offset_diff_hours: (tgtOffset - srcOffset),
      },
    }
  }

  /**
   * 解析日期时间字符串（尝试 ISO 格式和常见格式）。
   * 对应 Python datetime.fromisoformat / datetime.strptime。
   */
  private _parseDatetime(datetimeStr: string): Date | null {
    // 尝试 ISO 解析
    const isoDate = new Date(datetimeStr)
    if (!isNaN(isoDate.getTime())) {
      return isoDate
    }

    // 尝试常见格式：YYYY-MM-DD HH:MM:SS, YYYY-MM-DD, YYYY/MM/DD HH:MM:SS
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
      /^(\d{4})-(\d{2})-(\d{2})$/,
      /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    ]
    for (const fmt of formats) {
      const m = datetimeStr.match(fmt)
      if (m) {
        if (m.length === 4) {
          // YYYY-MM-DD
          const date = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
          if (!isNaN(date.getTime())) return date
        } else {
          // 完整日期时间
          const date = new Date(
            parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
            parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
          )
          if (!isNaN(date.getTime())) return date
        }
      }
    }

    return null
  }
}
