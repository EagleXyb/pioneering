/**
 * 可选依赖模块声明。
 *
 * 这些模块在 package.json 的 optionalDependencies 中声明，
 * 或作为动态 import 使用 try/catch 降级。
 * 此文件提供最小类型声明，使 tsc 能在未安装时通过编译。
 */

// ChromaDB — 向量数据库（记忆持久化）
declare module 'chromadb' {
  export class Client {
    constructor(...args: any[])
    getOrCreateCollection(...args: any[]): Promise<any>
  }
  export class PersistentClient {
    constructor(opts?: { path?: string }): PersistentClient
    getOrCreateCollection(...args: any[]): Promise<any>
  }
}

// OpenTelemetry — 分布式追踪（observability）
declare module '@opentelemetry/api' {
  export const trace: any
  export const context: any
  export const SpanStatusCode: any
  const _default: any
  export default _default
}

declare module '@opentelemetry/exporter-trace-otlp-grpc' {
  export class OTLPTraceExporter {
    constructor(opts?: any): OTLPTraceExporter
  }
  const _default: any
  export default _default
}

declare module '@opentelemetry/exporter-trace-otlp-http' {
  export class OTLPTraceExporter {
    constructor(opts?: any): OTLPTraceExporter
  }
  const _default: any
  export default _default
}

declare module '@opentelemetry/sdk-trace-base' {
  export class TracerProvider {
    constructor(...args: any[]): TracerProvider
    addSpanProcessor(processor: any): void
    register(...args: any[]): void
    shutdown(): Promise<void>
  }
  export class BatchSpanProcessor {
    constructor(exporter: any, opts?: any): BatchSpanProcessor
  }
  export class ConsoleSpanExporter {
    constructor(...args: any[]): ConsoleSpanExporter
  }
  export class SimpleSpanProcessor {
    constructor(exporter: any): SimpleSpanProcessor
  }
  const _default: any
  export default _default
}

declare module '@opentelemetry/resources' {
  export class Resource {
    static create(attrs?: Record<string, any>): Resource
  }
  const _default: any
  export default _default
}

// Prometheus — 指标导出（observability）
declare module 'prom-client' {
  export class Registry {
    constructor(): Registry
    registerMetric(metric: any): void
    metrics(): string
    contentType: string
  }
  export class Counter {
    constructor(opts: any): Counter
    inc(value?: number): void
    inc(labels: Record<string, any>, value?: number): void
  }
  export class Histogram {
    constructor(opts: any): Histogram
    observe(value: number): void
    observe(labels: Record<string, any>, value: number): void
  }
  export class Gauge {
    constructor(opts: any): Gauge
    set(value: number): void
    set(labels: Record<string, any>, value: number): void
  }
  export function collectDefaultMetrics(opts?: any): void
  export const register: any
  const _default: any
  export default _default
}

// better-sqlite3 — SQLite 驱动（工具模块）
declare module 'better-sqlite3' {
  export class Database {
    constructor(path: string, opts?: any): Database
    prepare(sql: string): { get(...params: any[]): any; all(...params: any[]): any[]; run(...params: any[]): any }
    exec(sql: string): void
    close(): void
  }
  export default Database
}
