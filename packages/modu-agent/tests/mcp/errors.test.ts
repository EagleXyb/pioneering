import { describe, it, expect } from 'vitest'
import {
  MCPError,
  MCPConnectionError,
  MCPTimeoutError,
  MCPToolNotFoundError,
  MCPProtocolError,
} from '@/mcp/errors.js'

describe('MCP error hierarchy', () => {
  it('MCPError is an Error with code MCP_000', () => {
    const e = new MCPError('boom')
    expect(e).toBeInstanceOf(Error)
    expect(e.error_code).toBe('MCP_000')
  })

  it('subclasses extend MCPError and carry their own codes', () => {
    expect(new MCPConnectionError('x')).toBeInstanceOf(MCPError)
    expect(new MCPConnectionError('x').error_code).toBe('MCP_001')
    expect(new MCPTimeoutError('x').error_code).toBe('MCP_002')
    expect(new MCPToolNotFoundError('x').error_code).toBe('MCP_003')
    expect(new MCPProtocolError('x').error_code).toBe('MCP_004')
  })
})
