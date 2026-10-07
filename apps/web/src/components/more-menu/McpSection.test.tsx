/**
 * McpSection 单元测试（T5.2）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const api = vi.hoisted(() => ({
  getMcpServers: vi.fn(),
  getMcpPolicy: vi.fn(),
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
  updateMcpPolicy: vi.fn(),
}))

vi.mock('@/api/mcp', () => ({
  getMcpServers: api.getMcpServers,
  getMcpPolicy: api.getMcpPolicy,
  startMcpServer: api.startMcpServer,
  stopMcpServer: api.stopMcpServer,
  updateMcpPolicy: api.updateMcpPolicy,
}))

import { McpSection } from './McpSection'

const policy = { hitlEnabled: true, sensitiveTools: [] as string[] }

const connectedServer = {
  name: 'github',
  enabled: true,
  transport: 'stdio',
  connected: true,
  toolCount: 1,
  tools: [{ name: 'search_repos', description: '搜仓库' }],
}
const disconnectedServer = {
  ...connectedServer,
  connected: false,
  toolCount: 0,
  tools: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getMcpPolicy.mockResolvedValue(policy)
})

describe('McpSection（T5.2）基础态', () => {
  it('空配置显示提示文案', async () => {
    api.getMcpServers.mockResolvedValue({ servers: [], total: 0 })
    render(<McpSection />)
    await waitFor(() =>
      expect(screen.getByText(/暂无配置的 MCP server/)).toBeInTheDocument(),
    )
  })

  it('渲染 server 名称与连接状态', async () => {
    api.getMcpServers.mockResolvedValue({
      total: 2,
      servers: [
        { ...connectedServer, tools: [] },
        { name: 'slack', enabled: true, transport: 'sse', connected: false, toolCount: 0, tools: [] },
      ],
    })
    render(<McpSection />)

    await waitFor(() => expect(screen.getByText('github')).toBeInTheDocument())
    expect(screen.getByText('slack')).toBeInTheDocument()
    expect(screen.getByText('已连接')).toBeInTheDocument()
    expect(screen.getByText('未连接')).toBeInTheDocument()
  })

  it('加载失败显示重试，点击重新拉取', async () => {
    api.getMcpServers
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce({ servers: [], total: 0 })
    render(<McpSection />)

    await waitFor(() =>
      expect(screen.getByText(/加载失败/)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() =>
      expect(screen.getByText(/暂无配置的 MCP server/)).toBeInTheDocument(),
    )
    expect(api.getMcpServers).toHaveBeenCalledTimes(2)
  })
})

describe('McpSection（T5.2）工具清单', () => {
  it('展开/收起查看 server 提供的工具', async () => {
    api.getMcpServers.mockResolvedValue({
      servers: [connectedServer],
      total: 1,
    })
    render(<McpSection />)

    await waitFor(() =>
      expect(screen.getByText('github')).toBeInTheDocument(),
    )
    expect(screen.queryByText('search_repos')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开工具清单' }))
    expect(screen.getByText('search_repos')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '收起工具清单' }))
    await waitFor(() =>
      expect(screen.queryByText('search_repos')).not.toBeInTheDocument(),
    )
  })
})

describe('McpSection（T5.2）server 启停', () => {
  it('点击启动：调 startMcpServer 并刷新连接状态', async () => {
    api.getMcpServers
      .mockResolvedValueOnce({ servers: [disconnectedServer], total: 1 })
      .mockResolvedValueOnce({ servers: [connectedServer], total: 1 })
    api.startMcpServer.mockResolvedValue({})

    render(<McpSection />)
    await waitFor(() =>
      expect(screen.getByText('github')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: '启动 github' }))

    await waitFor(() =>
      expect(api.startMcpServer).toHaveBeenCalledWith('github'),
    )
    await waitFor(() =>
      expect(screen.getByText('已连接')).toBeInTheDocument(),
    )
  })

  it('点击停止：调 stopMcpServer 并刷新连接状态', async () => {
    api.getMcpServers
      .mockResolvedValueOnce({ servers: [connectedServer], total: 1 })
      .mockResolvedValueOnce({ servers: [disconnectedServer], total: 1 })
    api.stopMcpServer.mockResolvedValue({})

    render(<McpSection />)
    await waitFor(() =>
      expect(screen.getByText('github')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: '停止 github' }))

    await waitFor(() =>
      expect(api.stopMcpServer).toHaveBeenCalledWith('github'),
    )
    await waitFor(() =>
      expect(screen.getByText('未连接')).toBeInTheDocument(),
    )
  })
})

describe('McpSection（T5.2）工具审批策略', () => {
  it('开启工具审批：把全限定名加入 sensitiveTools', async () => {
    api.getMcpServers.mockResolvedValue({
      servers: [connectedServer],
      total: 1,
    })
    api.getMcpPolicy.mockResolvedValue(policy)
    api.updateMcpPolicy.mockResolvedValue({
      hitlEnabled: true,
      sensitiveTools: ['github__search_repos'],
    })

    render(<McpSection />)
    await waitFor(() =>
      expect(screen.getByText('github')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '展开工具清单' }))

    const sw = screen.getByRole('switch', {
      name: 'search_repos 人工审批开关',
    })
    expect(sw).not.toBeChecked()

    fireEvent.click(sw)

    await waitFor(() =>
      expect(api.updateMcpPolicy).toHaveBeenCalledWith({
        sensitiveTools: ['github__search_repos'],
      }),
    )
    await waitFor(() => expect(sw).toBeChecked())
  })

  it('关闭工具审批：从 sensitiveTools 移除', async () => {
    api.getMcpServers.mockResolvedValue({
      servers: [connectedServer],
      total: 1,
    })
    api.getMcpPolicy.mockResolvedValue({
      hitlEnabled: true,
      sensitiveTools: ['github__search_repos'],
    })
    api.updateMcpPolicy.mockResolvedValue({
      hitlEnabled: true,
      sensitiveTools: [],
    })

    render(<McpSection />)
    await waitFor(() =>
      expect(screen.getByText('github')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: '展开工具清单' }))

    const sw = screen.getByRole('switch', {
      name: 'search_repos 人工审批开关',
    })
    expect(sw).toBeChecked()

    fireEvent.click(sw)

    await waitFor(() =>
      expect(api.updateMcpPolicy).toHaveBeenCalledWith({
        sensitiveTools: [],
      }),
    )
    await waitFor(() => expect(sw).not.toBeChecked())
  })
})
