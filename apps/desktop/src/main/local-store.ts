// ============================================================
// Local Chat Store — 主进程本地会话/消息持久化（云边双模阶段 2）
//
// 目标：本地（边）模式下桌面成为自洽产品——会话与消息落
// userData/local-chat.db（SQLite），断网可用，去掉对云端
// backend-ts 的运行时依赖。
//
// 约束与约定：
//   - 表结构对齐云端 PostgreSQL schema（apps/backend-ts/prisma/
//     schema.prisma 的 chat_sessions / chat_messages，snake_case
//     列名一致），阶段 4「本地→云单向同步」可直接复用行结构。
//   - 建表用幂等 CREATE TABLE IF NOT EXISTS（对齐 Python 侧
//     init_db 的 _IDEMPOTENT_COLUMNS 模式）——本项目全局禁用
//     prisma migrate / db push。
//   - HITL 约定：interrupt 暂停的半截 assistant 消息不落库；
//     resume 终态由渲染端聚合完成后经 LOCAL_CHAT_APPEND_MESSAGES
//     落库（渲染端 stream-handler 已有完整聚合，主进程不重复实现）。
//   - 单用户：user_id 固定 LOCAL_USER_ID（与 agent-runtime 一致）。
//   - better-sqlite3 为可选原生依赖：缺失时打开失败并返回错误
//     （对齐 modu-agent sql-query.ts 的降级模式，不崩溃）。
// ============================================================

import { randomUUID } from 'crypto'
import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import type { ChatSession, ChatMessage } from '../shared/types'

// ESM 主进程加载原生 CJS 模块（better-sqlite3）的标准方式
const nodeRequire = createRequire(import.meta.url)

const logger = {
  info: (msg: string, ...args: unknown[]) => console.info(`[local-store] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[local-store] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[local-store] ${msg}`, ...args),
}

/** 本地单用户标识（与 agent-runtime.LOCAL_USER_ID 保持一致） */
export const LOCAL_USER_ID = 'local_user'

/** 与云端一致的默认会话标题 */
const DEFAULT_SESSION_TITLE = '新对话'

/** 消息单页上限（对齐渲染端 chatService.getMessages 默认 50） */
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

// ============================================================
// 幂等建表 DDL（可重复执行；列名对齐云端 PG schema）
// ============================================================

const DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS chat_sessions (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL DEFAULT '${LOCAL_USER_ID}',
    title          TEXT NOT NULL DEFAULT '${DEFAULT_SESSION_TITLE}',
    model          TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    model_config   TEXT,
    system_prompt  TEXT,
    message_count  INTEGER NOT NULL DEFAULT 0,
    last_message_id TEXT,
    is_archived    INTEGER NOT NULL DEFAULT 0,
    agent_mode     TEXT,
    runtime        TEXT NOT NULL DEFAULT 'local',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    user_id           TEXT NOT NULL DEFAULT '${LOCAL_USER_ID}',
    parent_message_id TEXT,
    role              TEXT NOT NULL,
    content           TEXT NOT NULL DEFAULT '',
    content_blocks    TEXT,
    token_count       INTEGER,
    feedback          TEXT NOT NULL DEFAULT 'none',
    metadata          TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_local_chat_messages_session ON chat_messages(session_id, created_at)',
]

// ---- 行类型 ----

interface SessionRow {
  id: string
  user_id: string
  title: string
  model: string
  model_config: string | null
  system_prompt: string | null
  message_count: number
  last_message_id: string | null
  is_archived: number
  agent_mode: string | null
  runtime: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  session_id: string
  user_id: string
  parent_message_id: string | null
  role: string
  content: string
  content_blocks: string | null
  token_count: number | null
  feedback: string
  metadata: string | null
  created_at: string
  updated_at: string
}

// ---- 行 → DTO 映射 ----

function toSessionDto(row: SessionRow): ChatSession {
  let modelConfig: Record<string, unknown> | undefined
  if (row.model_config) {
    try {
      modelConfig = JSON.parse(row.model_config)
    } catch {
      modelConfig = undefined
    }
  }
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    modelConfig,
    isArchived: row.is_archived === 1,
    messageCount: row.message_count,
    agentMode: row.agent_mode ?? undefined,
    runtime: 'local',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toMessageDto(row: MessageRow): ChatMessage {
  let contentBlocks: ChatMessage['contentBlocks']
  if (row.content_blocks) {
    try {
      const parsed = JSON.parse(row.content_blocks)
      if (Array.isArray(parsed)) contentBlocks = parsed
    } catch {
      contentBlocks = undefined
    }
  }
  const feedback = row.feedback
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    parentMessageId: row.parent_message_id ?? undefined,
    tokenCount: row.token_count ?? undefined,
    feedback: feedback === 'like' || feedback === 'dislike' ? feedback : 'none',
    createdAt: row.created_at,
    contentBlocks,
  }
}

// ============================================================
// LocalChatStore
// ============================================================

export class LocalChatStore {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  /** 打开（或创建）本地库并幂等建表。better-sqlite3 缺失/路径不可写时抛错。 */
  static open(dbPath: string): LocalChatStore {
    // createRequire 同步加载原生 CJS 模块；缺失时抛 MODULE_NOT_FOUND 由调用方降级
    const DatabaseCtor = nodeRequire('better-sqlite3') as typeof Database
    const db = new DatabaseCtor(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    for (const ddl of DDL_STATEMENTS) db.exec(ddl)
    logger.info('opened db=%s', dbPath)
    return new LocalChatStore(db)
  }

  // ---- 会话 ----

  listSessions(opts: {
    page?: number
    pageSize?: number
    archived?: boolean
  }): { sessions: ChatSession[]; total: number } {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE))
    const archived = opts.archived ?? false
    const where = 'is_archived = ?'
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM chat_sessions WHERE ${where}`).get(archived ? 1 : 0) as { c: number }
    ).c
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_sessions WHERE ${where}
         ORDER BY datetime(updated_at) DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(archived ? 1 : 0, pageSize, (page - 1) * pageSize) as SessionRow[]
    return { sessions: rows.map(toSessionDto), total }
  }

  createSession(input: {
    title?: string
    agentMode?: string
    model?: string
    systemPrompt?: string
  }): ChatSession {
    const now = new Date().toISOString()
    const row: SessionRow = {
      id: `sess_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      user_id: LOCAL_USER_ID,
      title: (input.title ?? '').trim() || DEFAULT_SESSION_TITLE,
      model: input.model ?? 'gpt-4o-mini',
      model_config: null,
      system_prompt: input.systemPrompt ?? null,
      message_count: 0,
      last_message_id: null,
      is_archived: 0,
      agent_mode: input.agentMode ?? null,
      runtime: 'local',
      created_at: now,
      updated_at: now,
    }
    this.db
      .prepare(
        `INSERT INTO chat_sessions
         (id, user_id, title, model, model_config, system_prompt, message_count,
          last_message_id, is_archived, agent_mode, runtime, created_at, updated_at)
         VALUES (@id, @user_id, @title, @model, @model_config, @system_prompt, @message_count,
          @last_message_id, @is_archived, @agent_mode, @runtime, @created_at, @updated_at)`,
      )
      .run(row)
    logger.info('session.created id=%s title=%s', row.id, row.title)
    return toSessionDto(row)
  }

  updateSession(
    sessionId: string,
    patch: { title?: string; modelConfig?: Record<string, unknown>; isArchived?: boolean },
  ): ChatSession | null {
    const prev = this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId) as
      | SessionRow
      | undefined
    if (!prev) return null
    const next: SessionRow = {
      ...prev,
      title: patch.title !== undefined ? patch.title.trim() || prev.title : prev.title,
      model_config:
        patch.modelConfig !== undefined ? JSON.stringify(patch.modelConfig) : prev.model_config,
      is_archived: patch.isArchived !== undefined ? (patch.isArchived ? 1 : 0) : prev.is_archived,
      updated_at: new Date().toISOString(),
    }
    this.db
      .prepare(
        `UPDATE chat_sessions SET title=@title, model_config=@model_config,
         is_archived=@is_archived, updated_at=@updated_at WHERE id=@id`,
      )
      .run(next)
    return toSessionDto(next)
  }

  /** 物理删除会话并级联删除消息（本地库无归档恢复诉求，简化为硬删） */
  deleteSession(sessionId: string): boolean {
    const tx = this.db.transaction(() => {
      const delMsgs = this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId)
      const delSession = this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId)
      return { delMsgs, delSession }
    })
    const { delMsgs, delSession } = tx()
    logger.info(
      'session.deleted id=%s messages=%d ok=%s',
      sessionId, delMsgs.changes, delSession.changes > 0,
    )
    return delSession.changes > 0
  }

  // ---- 消息 ----

  /**
   * 按会话分页读取消息（createdAt DESC，最新在前——对齐云端
   * /chat/sessions/:id/messages 的游标分页语义）。
   * cursor = 上一页最后（最旧）一条消息的 id。
   */
  listMessages(opts: {
    sessionId: string
    cursor?: string
    limit?: number
  }): { messages: ChatMessage[]; nextCursor?: string } {
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.limit ?? DEFAULT_PAGE_SIZE))
    const sessionId = opts.sessionId
    let rows: MessageRow[]
    if (opts.cursor) {
      const cursorRow = this.db
        .prepare('SELECT * FROM chat_messages WHERE id = ?')
        .get(opts.cursor) as MessageRow | undefined
      if (!cursorRow) {
        return { messages: [] }
      }
      rows = this.db
        .prepare(
          `SELECT * FROM chat_messages WHERE session_id = ?
           AND (datetime(created_at) < datetime(?) OR (created_at = ? AND id < ?))
           ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`,
        )
        .all(sessionId, cursorRow.created_at, cursorRow.created_at, cursorRow.id, limit) as MessageRow[]
    } else {
      rows = this.db
        .prepare(
          'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ?',
        )
        .all(sessionId, limit) as MessageRow[]
    }
    const messages = rows.map(toMessageDto)
    // 返回前按时间正序（旧→新），对齐云端「messages 数组按 createdAt 正序」的返回形状
    messages.reverse()
    const hasMore = rows.length === limit
    const nextCursor = hasMore && rows.length > 0 ? rows[rows.length - 1]!.id : undefined
    return { messages, nextCursor }
  }

  /**
   * 批量追加消息（事务）：INSERT OR IGNORE 幂等（重复提交同一消息 id
   * 不报错、不重复计数），同时维护会话 message_count / last_message_id /
   * updated_at。用户消息发送时即时落库；assistant 终态由渲染端聚合后落库。
   */
  appendMessages(sessionId: string, messages: ChatMessage[]): number {
    if (messages.length === 0) return 0
    const now = new Date().toISOString()
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO chat_messages
       (id, session_id, user_id, parent_message_id, role, content, content_blocks,
        token_count, feedback, metadata, created_at, updated_at)
       VALUES (@id, @session_id, @user_id, @parent_message_id, @role, @content, @content_blocks,
        @token_count, @feedback, @metadata, @created_at, @updated_at)`,
    )
    const touchSession = this.db.prepare(
      `UPDATE chat_sessions SET
         message_count = message_count + @n,
         last_message_id = @last_id,
         updated_at = @updated_at
       WHERE id = @session_id`,
    )
    const tx = this.db.transaction(() => {
      let inserted = 0
      let lastId: string | null = null
      for (const m of messages) {
        const row: MessageRow = {
          id: m.id,
          session_id: sessionId,
          user_id: LOCAL_USER_ID,
          parent_message_id: m.parentMessageId ?? null,
          role: m.role,
          content: m.content ?? '',
          content_blocks: m.contentBlocks ? JSON.stringify(m.contentBlocks) : null,
          token_count: m.tokenCount ?? null,
          feedback: m.feedback ?? 'none',
          metadata: null,
          created_at: m.createdAt || now,
          updated_at: now,
        }
        const res = insert.run(row)
        if (res.changes > 0) {
          inserted++
          lastId = m.id
        }
      }
      if (inserted > 0) {
        touchSession.run({
          n: inserted,
          last_id: lastId,
          session_id: sessionId,
          updated_at: now,
        })
      }
      return inserted
    })
    const inserted = tx()
    logger.info('messages.appended session=%s count=%d/%d', sessionId, inserted, messages.length)
    return inserted
  }

  /**
   * 按 id 删除指定消息（regenerate 截断等场景），事务内同步修正
   * message_count / last_message_id。不存在的 id 静默忽略。
   */
  deleteMessages(sessionId: string, messageIds: string[]): number {
    if (messageIds.length === 0) return 0
    const tx = this.db.transaction(() => {
      let deleted = 0
      for (const id of messageIds) {
        const res = this.db
          .prepare('DELETE FROM chat_messages WHERE session_id = ? AND id = ?')
          .run(sessionId, id)
        deleted += res.changes
      }
      if (deleted > 0) {
        const last = this.db
          .prepare(
            `SELECT id FROM chat_messages WHERE session_id = ?
             ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
          )
          .get(sessionId) as { id: string } | undefined
        this.db
          .prepare(
            `UPDATE chat_sessions SET
               message_count = MAX(message_count - @n, 0),
               last_message_id = @last_id,
               updated_at = @updated_at
             WHERE id = @session_id`,
          )
          .run({
            n: deleted,
            last_id: last?.id ?? null,
            session_id: sessionId,
            updated_at: new Date().toISOString(),
          })
      }
      return deleted
    })
    const deleted = tx()
    logger.info('messages.deleted session=%s count=%d/%d', sessionId, deleted, messageIds.length)
    return deleted
  }

  updateMessageFeedback(messageId: string, feedback: 'like' | 'dislike' | 'none'): boolean {
    const res = this.db
      .prepare('UPDATE chat_messages SET feedback = ?, updated_at = ? WHERE id = ?')
      .run(feedback, new Date().toISOString(), messageId)
    return res.changes > 0
  }

  close(): void {
    this.db.close()
  }
}

// ============================================================
// 单例（主进程内共享；由 ipc-handlers 以 userData 路径初始化）
// ============================================================

let _store: LocalChatStore | null = null
let _openError: string | null = null

/** 惰性打开本地库；失败（原生模块缺失/磁盘不可写）时记录错误并持续返回 null */
export function getLocalChatStore(dbPath: string): LocalChatStore | null {
  if (_store) return _store
  if (_openError) return null
  try {
    _store = LocalChatStore.open(dbPath)
    return _store
  } catch (e) {
    _openError = String(e)
    logger.error('open.failed db=%s err=%s', dbPath, _openError)
    return null
  }
}

/** 仅供测试重置单例 */
export function resetLocalChatStoreForTest(): void {
  _store?.close()
  _store = null
  _openError = null
}
