// P1-11：PersistentEventLog 攒批落盘 + 有界队列回归。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { EventBus, PersistentEventLog } from '@/orchestration/communication/message-bus.js'
import { AgentEvent } from '@/orchestration/communication/protocol.js'

function makeEvent(domain = 'audit', action = 'record'): AgentEvent {
  return new AgentEvent({
    user_id: 'u1',
    session_id: 's1',
    domain,
    action,
  })
}

describe('P1-11 · PersistentEventLog 攒批落盘', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-eventlog-'))
    logPath = path.join(tmpDir, 'events.jsonl')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('多事件经少量批次合并落盘：stop 排空队列，行数不丢', async () => {
    const bus = new EventBus()
    const log = new PersistentEventLog({
      log_file_path: logPath,
      write_batch_size: 10,
      write_flush_interval_ms: 50,
    })
    await log.start(bus)
    try {
      for (let i = 0; i < 23; i++) bus.publish(makeEvent('audit', `act_${i}`))
    } finally {
      await log.stop()
    }

    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim())
    expect(lines).toHaveLength(23)
    const parsed = lines.map((l) => JSON.parse(l))
    expect(parsed[0].domain).toBe('audit')
    expect(parsed[0].action).toBe('act_0')
    expect(parsed[22].action).toBe('act_22')
  })

  it('domain 过滤行为不回归', async () => {
    const bus = new EventBus()
    const log = new PersistentEventLog({
      log_file_path: logPath,
      domains: ['security'],
      write_batch_size: 10,
      write_flush_interval_ms: 50,
    })
    await log.start(bus)
    try {
      bus.publish(makeEvent('security', 'a1'))
      bus.publish(makeEvent('audit', 'a2'))
      bus.publish(makeEvent('security', 'a3'))
    } finally {
      await log.stop()
    }
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim())
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => JSON.parse(l).domain === 'security')).toBe(true)
  })

  it('TTL 过期事件不入库（行为不回归）', async () => {
    const bus = new EventBus()
    const log = new PersistentEventLog({
      log_file_path: logPath,
      event_ttl_ms: 1000,
      write_batch_size: 10,
      write_flush_interval_ms: 50,
    })
    await log.start(bus)
    try {
      const fresh = makeEvent()
      const old = makeEvent()
      // 人为把旧事件时间戳调到 5s 前
      ;(old as any).timestamp = new Date(Date.now() - 5000)
      bus.publish(fresh)
      bus.publish(old)
    } finally {
      await log.stop()
    }
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim())
    expect(lines).toHaveLength(1)
  })

  it('首条批次即创建文件（无 existsSync 预检也不影响功能）', async () => {
    expect(fs.existsSync(logPath)).toBe(false)
    const bus = new EventBus()
    const log = new PersistentEventLog({
      log_file_path: logPath,
      write_batch_size: 5,
      write_flush_interval_ms: 20,
    })
    await log.start(bus)
    try {
      bus.publish(makeEvent())
    } finally {
      await log.stop()
    }
    expect(fs.existsSync(logPath)).toBe(true)
  })
})

describe('P1-11 · PersistentEventLog 有界队列', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-eventlog-cap-'))
    logPath = path.join(tmpDir, 'events.jsonl')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('队列达上限后丢弃最旧事件、计数增长，队列长度不超过上限（写入器不启动）', async () => {
    const log = new PersistentEventLog({
      log_file_path: logPath,
      max_queue_size: 3,
    })
    // 不启动写入器：仅打开 enabled 开关后直灌回调（等价事件洪峰、磁盘写入阻塞）
    ;(log as any)._enabled = true
    const onEvent = (log as any)._on_event.bind(log) as (e: AgentEvent) => Promise<void>
    for (let i = 0; i < 7; i++) await onEvent(makeEvent('audit', `e${i}`))

    expect(log.queueLength).toBe(3)
    expect(log.droppedCount).toBe(4)

    // 保留的是最新 3 条（e4/e5/e6），最旧 e0 被丢
    const queued = ((log as any)._write_queue as AgentEvent[]).map((e) => e.action)
    expect(queued).toEqual(['e4', 'e5', 'e6'])
  })

  it('默认队列上限为 1000（构造缺省值不报错）', () => {
    const log = new PersistentEventLog(logPath)
    expect(log.queueLength).toBe(0)
    expect(log.droppedCount).toBe(0)
  })
})
