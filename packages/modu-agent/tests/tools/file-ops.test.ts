import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileOpsTool } from '@/tools/file-ops.js'

describe('FileOpsTool', () => {
  let root: string
  let tool: FileOpsTool

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'modu-fileops-'))
    tool = new FileOpsTool(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns its name and requires approval', () => {
    expect(tool.name()).toBe('file_ops')
    expect(tool.requiresApproval()).toBe(true)
  })

  it('writes and reads a file within the workspace', async () => {
    const w = await tool.invoke({ op: 'write', path: 'a.txt', content: 'hello' }, {}) as any
    expect(w.status).toBe('success')
    const r = await tool.invoke({ op: 'read', path: 'a.txt' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.content).toBe('hello')
    expect(r.data.truncated).toBe(false)
  })

  it('lists directory entries', async () => {
    await tool.invoke({ op: 'write', path: 'a.txt', content: 'x' }, {})
    await tool.invoke({ op: 'write', path: 'b.txt', content: 'y' }, {})
    const r = await tool.invoke({ op: 'list', path: '.' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.entries.map((e: any) => e.name).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('deletes a file', async () => {
    await tool.invoke({ op: 'write', path: 'a.txt', content: 'x' }, {})
    const d = await tool.invoke({ op: 'delete', path: 'a.txt' }, {}) as any
    expect(d.status).toBe('success')
    const r = await tool.invoke({ op: 'read', path: 'a.txt' }, {}) as any
    expect(r.status).toBe('error')
  })

  it('rejects path traversal (..)', async () => {
    const r = await tool.invoke({ op: 'read', path: '../secret.txt' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('FILE_002')
  })

  it('rejects absolute paths', async () => {
    const r = await tool.invoke({ op: 'read', path: '/etc/passwd' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('FILE_002')
  })

  it('rejects an invalid op', async () => {
    const r = await tool.invoke({ op: 'frobnicate', path: 'a.txt' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('FILE_001')
  })

  // === P1-13：大文件限量读（内存有界）===
  describe('P1-13 限量读取', () => {
    const MAX_BYTES = 256 * 1024

    it('大文件只返回前 256KB，truncated=true，size 为真实大小', async () => {
      const big = 'a'.repeat(MAX_BYTES + 1024)
      await tool.invoke({ op: 'write', path: 'big.txt', content: big }, {})

      const r = await tool.invoke({ op: 'read', path: 'big.txt' }, {}) as any
      expect(r.status).toBe('success')
      expect(r.data.size).toBe(MAX_BYTES + 1024)
      expect(r.data.truncated).toBe(true)
      // 字节级有界：ASCII 1 字符 1 字节，content 恰为 256KB
      expect(Buffer.byteLength(r.data.content, 'utf-8')).toBe(MAX_BYTES)
      expect(r.data.content.startsWith('aaa')).toBe(true)
    })

    it('恰为 256KB 的文件不判定截断', async () => {
      const exact = 'b'.repeat(MAX_BYTES)
      await tool.invoke({ op: 'write', path: 'exact.txt', content: exact }, {})
      const r = await tool.invoke({ op: 'read', path: 'exact.txt' }, {}) as any
      expect(r.data.truncated).toBe(false)
      expect(Buffer.byteLength(r.data.content, 'utf-8')).toBe(MAX_BYTES)
    })

    it('读取不存在的文件仍返回 FILE_003（预检语义不回归）', async () => {
      const r = await tool.invoke({ op: 'read', path: 'nope.txt' }, {}) as any
      expect(r.status).toBe('error')
      expect(r.error_code).toBe('FILE_003')
    })

    it('读取目录返回 FILE_004（预检语义不回归）', async () => {
      const r = await tool.invoke({ op: 'read', path: '.' }, {}) as any
      expect(r.status).toBe('error')
      expect(r.error_code).toBe('FILE_004')
    })
  })
})
