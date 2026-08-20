// knowledge-index.ts
//
// P2（文档 4.3 建议8 / 4.4-P2）落地项：knowledge-index.json 知识库索引。
//
// 提供结构化的检索索引（向量/条目）读写与内存检索。机器生成/交换，JSON 格式，
// 用于知识库条目索引化。由 memory/ 检索模块或宿主显式消费。
//
// 设计约束（严守"不修改原有业务逻辑、不引入新缺陷"）：
//   - 纯工具类、无副作用：不接入既有 Chroma 记忆等运行时路径。
//   - 文件缺失/解析失败返回空索引，不抛异常。
//   - 不依赖外部检索库，提供基础的字符串匹配（标题/正文/标签）检索。

import fs from 'fs'
import path from 'path'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[config.knowledge_index] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[config.knowledge_index] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[config.knowledge_index] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[config.knowledge_index] ${msg}`, ...args),
}

/** 知识库索引条目。 */
export interface KnowledgeEntry {
  /** 全局唯一 ID */
  id: string
  /** 标题 */
  title: string
  /** 正文/内容摘要 */
  content?: string
  /** 分类标签 */
  tags?: string[]
  /** 向量（可选，用于未来相似度检索） */
  vector?: number[]
  /** 附加元数据 */
  [key: string]: any
}

/** 知识库索引文件结构。 */
export interface KnowledgeIndexFile {
  /** 版本号 */
  version?: number
  /** 条目列表 */
  entries: KnowledgeEntry[]
}

/**
 * 内存知识库索引。
 *
 * 支持 add / remove / get / search，以及 saveToFile / loadFromFile（JSON）。
 * 纯内存，不自动持久化；宿主按需调用 saveToFile。
 */
export class KnowledgeIndex {
  private _entries: Map<string, KnowledgeEntry>

  constructor(entries?: KnowledgeEntry[]) {
    this._entries = new Map()
    if (Array.isArray(entries)) {
      for (const e of entries) {
        if (e && typeof e.id === 'string') this._entries.set(e.id, e)
      }
    }
  }

  /** 添加或覆盖条目。 */
  add(entry: KnowledgeEntry): void {
    if (!entry || typeof entry.id !== 'string' || entry.id === '') {
      throw new Error('knowledge-index: entry.id must be a non-empty string')
    }
    this._entries.set(entry.id, entry)
  }

  /** 按 id 移除条目。 */
  remove(id: string): boolean {
    return this._entries.delete(id)
  }

  /** 按 id 查询条目。 */
  get(id: string): KnowledgeEntry | null {
    return this._entries.get(id) ?? null
  }

  /** 所有条目（按插入序）。 */
  all(): KnowledgeEntry[] {
    return [...this._entries.values()]
  }

  /** 条目数量。 */
  size(): number {
    return this._entries.size
  }

  /**
   * 基础文本检索：匹配 title / content / tags / id（大小写不敏感子串）。
   *
   * @param query 检索词
   * @param opts.limit 返回上限（默认全部）
   * @returns 匹配的条目（保持插入序）
   */
  search(query: string, opts: { limit?: number } = {}): KnowledgeEntry[] {
    const q = query.toLowerCase()
    if (!q) return []
    const limit = opts.limit ?? this._entries.size
    const out: KnowledgeEntry[] = []
    for (const e of this._entries.values()) {
      const haystack = [
        e.id,
        e.title,
        e.content ?? '',
        ...(Array.isArray(e.tags) ? e.tags : []),
      ]
        .join(' ')
        .toLowerCase()
      if (haystack.includes(q)) {
        out.push(e)
        if (out.length >= limit) break
      }
    }
    return out
  }

  /** 转换为可序列化文件结构。 */
  toJSON(): KnowledgeIndexFile {
    return { version: 1, entries: this.all() }
  }

  /** 从文件结构对象恢复。 */
  static fromJSON(data: KnowledgeIndexFile): KnowledgeIndex {
    return new KnowledgeIndex(Array.isArray(data?.entries) ? data.entries : [])
  }

  /** 保存为 JSON 文件（原子写）。 */
  saveToFile(filePath: string): boolean {
    try {
      const abs = path.resolve(filePath)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      const tmp = `${abs}.tmp-${Date.now()}`
      fs.writeFileSync(tmp, JSON.stringify(this.toJSON(), null, 2), 'utf-8')
      fs.renameSync(tmp, abs)
      return true
    } catch (e: any) {
      logger.warning('保存 knowledge-index.json 失败 %s: %s', filePath, String(e?.message ?? e))
      return false
    }
  }

  /** 从 JSON 文件加载；文件缺失/损坏返回空索引（不抛异常）。 */
  static loadFromFile(filePath: string): KnowledgeIndex {
    try {
      const abs = path.resolve(filePath)
      if (!fs.existsSync(abs)) return new KnowledgeIndex()
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'))
      return KnowledgeIndex.fromJSON(parsed)
    } catch (e: any) {
      logger.warning('加载 knowledge-index.json 失败 %s: %s', filePath, String(e?.message ?? e))
      return new KnowledgeIndex()
    }
  }
}
