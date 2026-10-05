import { describe, it, expect } from 'vitest'
import { detectDocArtifact } from '@/tools/doc-writer-artifact.js'

const OK = JSON.stringify({
  status: 'success',
  data: { name: 'r.md', path: '/o/r.md', size: 1, format: 'md' },
})

describe('T3-4 doc artifact single source', () => {
  it('detects doc_writer success', () => {
    const a = detectDocArtifact('doc_writer', OK)
    expect(a).not.toBeNull()
    expect(a!.type).toBe('document')
  })
  it('structural fallback by content', () => {
    expect(detectDocArtifact('other', OK)).not.toBeNull()
  })
  it('accepts parsed object', () => {
    expect(detectDocArtifact('doc_writer', JSON.parse(OK))).not.toBeNull()
  })
  it('rejects non-success status', () => {
    const bad = JSON.stringify({ status: 'error', data: { name: 'x.md', path: '/x.md', format: 'md' } })
    expect(detectDocArtifact('doc_writer', bad)).toBeNull()
  })
  it('rejects missing name', () => {
    const d = JSON.stringify({ status: 'success', data: { path: '/a.md', format: 'md' } })
    expect(detectDocArtifact('doc_writer', d)).toBeNull()
  })
  it('rejects non-md when tool name does not match', () => {
    const d = JSON.stringify({ status: 'success', data: { name: 'a.pdf', path: '/a.pdf', format: 'pdf' } })
    expect(detectDocArtifact('other_tool', d)).toBeNull()
  })

  it('doc_writer tool name alone suffices (legacy semantics)', () => {
    const d = JSON.stringify({ status: 'success', data: { name: 'a.pdf', path: '/a.pdf', format: 'pdf' } })
    expect(detectDocArtifact('doc_writer', d)).not.toBeNull()
  })
  it('tolerates bad input', () => {
    expect(detectDocArtifact('doc_writer', 'nope')).toBeNull()
    expect(detectDocArtifact('doc_writer', '')).toBeNull()
  })
})
