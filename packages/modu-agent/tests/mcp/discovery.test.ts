import { describe, it, expect } from 'vitest'
import { ToolInfo, ToolDiscovery } from '@/mcp/discovery.js'

describe('ToolInfo', () => {
  it('builds from an MCP dict and exposes a qualified name', () => {
    const info = ToolInfo.fromMcpDict('s1', {
      name: 'search',
      description: 'search tool',
      inputSchema: { type: 'object' },
    })
    expect(info.serverName).toBe('s1')
    expect(info.rawName).toBe('search')
    expect(info.qualifiedName).toBe('s1__search')
  })

  it('falls back to an empty schema when none provided', () => {
    const info = ToolInfo.fromMcpDict('s1', { name: 't' })
    expect(info.toBaseToolSchema()).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    })
  })
})

describe('ToolDiscovery', () => {
  it('updates, lists, and finds tools by qualified/raw name', () => {
    const d = new ToolDiscovery()
    const t1 = ToolInfo.fromMcpDict('s1', { name: 'a' })
    const t2 = ToolInfo.fromMcpDict('s2', { name: 'a' })
    d.update('s1', [t1])
    d.update('s2', [t2])

    expect(d.getAll().length).toBe(2)
    expect(d.getByServer('s1')).toEqual([t1])
    expect(d.findByName('s1__a')).toBe(t1)
    expect(d.findByName('a')).toBe(t1) // first raw match
  })

  it('clears the cache', () => {
    const d = new ToolDiscovery()
    d.update('s1', [ToolInfo.fromMcpDict('s1', { name: 'a' })])
    d.clear()
    expect(d.getAll().length).toBe(0)
  })
})
