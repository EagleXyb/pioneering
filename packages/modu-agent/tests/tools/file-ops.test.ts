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

  it('writes and reads a file within the workspace', () => {
    const w = tool.invoke({ op: 'write', path: 'a.txt', content: 'hello' }, {}) as any
    expect(w.status).toBe('success')
    const r = tool.invoke({ op: 'read', path: 'a.txt' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.content).toBe('hello')
  })

  it('lists directory entries', () => {
    tool.invoke({ op: 'write', path: 'a.txt', content: 'x' }, {})
    tool.invoke({ op: 'write', path: 'b.txt', content: 'y' }, {})
    const r = tool.invoke({ op: 'list', path: '.' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.entries.map((e: any) => e.name).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('deletes a file', () => {
    tool.invoke({ op: 'write', path: 'a.txt', content: 'x' }, {})
    const d = tool.invoke({ op: 'delete', path: 'a.txt' }, {}) as any
    expect(d.status).toBe('success')
    const r = tool.invoke({ op: 'read', path: 'a.txt' }, {}) as any
    expect(r.status).toBe('error')
  })

  it('rejects path traversal (..)', () => {
    const r = tool.invoke({ op: 'read', path: '../secret.txt' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('FILE_002')
  })

  it('rejects absolute paths', () => {
    const r = tool.invoke({ op: 'read', path: '/etc/passwd' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('FILE_002')
  })

  it('rejects an invalid op', () => {
    const r = tool.invoke({ op: 'frobnicate', path: 'a.txt' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('FILE_001')
  })
})
