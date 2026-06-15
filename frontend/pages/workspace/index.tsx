import React, { useState, useCallback } from 'react'
import { Layout, Button, Tabs } from 'tdesign-react'
import { MenuFoldIcon, MenuUnfoldIcon, AddIcon } from 'tdesign-icons-react'
import { ChatMode } from '../chat/ChatMode'
import { AgentMode } from '../agent-professional/AgentMode'
import './styles/variables.css'
import './styles/layout.css'
import './styles/sidebar.css'

const { Sider, Content } = Layout

type WorkspaceMode = 'chat' | 'agent'

const Workspace: React.FC = () => {
  const [activeMode, setActiveMode] = useState<WorkspaceMode>('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const handleModeChange = useCallback((mode: WorkspaceMode) => {
    setActiveMode(mode)
  }, [])

  return (
    <Layout className="workspace-layout">
      <Sider
        width={sidebarCollapsed ? 0 : 260}
        className={`workspace-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
      >
        <div className="workspace-sidebar-tabs">
          <Tabs
            value={activeMode}
            onChange={(val) => handleModeChange(val as WorkspaceMode)}
            tabs={[
              { label: '对话', value: 'chat' },
              { label: 'Agent', value: 'agent' },
            ]}
          />
        </div>
      </Sider>

      <div className="workspace-sidebar-toggle">
        <Button
          variant="text"
          shape="square"
          size="small"
          icon={sidebarCollapsed ? <MenuUnfoldIcon /> : <MenuFoldIcon />}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      <Content className="workspace-content">
        {activeMode === 'chat' ? <ChatMode /> : <AgentMode />}
      </Content>
    </Layout>
  )
}

export default Workspace
