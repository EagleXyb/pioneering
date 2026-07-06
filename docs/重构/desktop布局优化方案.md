# 桌面端 AI Agent 前端布局设计（仿 Trae Work 风格）

基于你的技术栈，我为你设计了一套完整的 **AI Agent 桌面工作台**布局方案。整体采用经典的 **三栏 + 多面板** 架构，类似 Trae Work 的 Work/Code/Design 多模式工作台。

---

## 📐 整体布局架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron TitleBar (自定义标题栏 + 模式切换 Work/Code/Design)     │
├──────┬──────────┬────────────────────────────┬──────────────────┤
│      │          │                            │                  │
│  A   │   S      │      Main Workspace        │   AI Chat        │
│  c   │   e      │      (主工作区)              │   Panel          │
│  t   │   c      │                            │   (对话面板)      │
│  i   │   o      │  ┌────────────────────┐    │                  │
│  v   │   n      │  │  Tab 1  │  Tab 2   │    │  ┌──────────┐    │
│  i   │   d      │  ├────────────────────┤    │  │ Messages  │   │
│  t   │   a      │  │                    │    │  │ (Markdown │   │
│  y   │   r      │  │   Content Area     │    │  │  Render)  │   │
│      │   y      │  │   (编辑器/预览/     │    │  │           │   │
│  B   │   P      │  │    设计画布)        │    │  │           │   │
│  a   │   a      │  │                    │    │  │           │   │
│  r   │   n      │  │                    │    │  │           │   │
│  │   │   e      │  └────────────────────┘    │  └──────────┘    │
│  │   │   l      │                            │  ┌──────────┐    │
│  │   │          │                            │  │ Input Bar │   │
│  │   │          │                            │  └──────────┘    │
├──────┴──────────┴────────────────────────────┴──────────────────┤
│  Bottom Panel (可折叠): Terminal / Output / Agent Logs           │
├─────────────────────────────────────────────────────────────────┤
│  Status Bar (模型状态 | Token用量 | 当前模式 | 网络状态)          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 项目目录结构

```
src/
├── main/                          # Electron 主进程
│   ├── index.ts
│   ├── ipc-handlers.ts
│   └── window-manager.ts
├── preload/
│   └── index.ts
├── renderer/                      # React 渲染进程
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.html
│   │
│   ├── layouts/                   # 布局组件
│   │   ├── RootLayout.tsx         # 根布局
│   │   ├── TitleBar.tsx           # 自定义标题栏
│   │   ├── StatusBar.tsx          # 底部状态栏
│   │   └── PanelManager.tsx       # 面板管理器
│   │
│   ├── components/
│   │   ├── sidebar/
│   │   │   ├── ActivityBar.tsx    # 最左侧图标栏
│   │   │   ├── SecondarySidebar.tsx # 二级侧边栏
│   │   │   ├── FileExplorer.tsx   # 文件浏览器
│   │   │   ├── ToolPanel.tsx      # 工具面板
│   │   │   └── HistoryPanel.tsx   # 历史记录
│   │   │
│   │   ├── workspace/
│   │   │   ├── WorkspacePanel.tsx # 主工作区容器
│   │   │   ├── TabBar.tsx         # 标签栏
│   │   │   ├── CodeEditor.tsx     # 代码编辑器
│   │   │   ├── PreviewPanel.tsx   # 预览面板
│   │   │   └── DesignCanvas.tsx   # 设计画布
│   │   │
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx      # 聊天面板容器
│   │   │   ├── MessageList.tsx    # 消息列表
│   │   │   ├── MessageBubble.tsx  # 消息气泡 (react-markdown)
│   │   │   ├── ChatInput.tsx      # 输入框
│   │   │   ├── AgentStatus.tsx    # Agent 执行状态
│   │   │   ├── ToolCallCard.tsx   # 工具调用卡片
│   │   │   └── ThinkingBlock.tsx  # 思考过程展示
│   │   │
│   │   ├── bottom-panel/
│   │   │   ├── BottomPanel.tsx    # 底部面板
│   │   │   ├── TerminalView.tsx   # 终端视图
│   │   │   └── AgentLogView.tsx   # Agent 日志
│   │   │
│   │   └── ui/                    # shadcn/ui 组件
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── resizable.tsx
│   │       ├── scroll-area.tsx
│   │       ├── tabs.tsx
│   │       ├── tooltip.tsx
│   │       └── ...
│   │
│   ├── pages/                     # 页面 (React Router v7)
│   │   ├── HomePage.tsx           # 首页/欢迎页
│   │   ├── WorkspacePage.tsx      # 工作区页面
│   │   └── SettingsPage.tsx       # 设置页面
│   │
│   ├── stores/                    # 状态管理
│   │   ├── useAppStore.ts         # Zustand: 全局应用状态
│   │   ├── useChatStore.ts        # Zustand: 聊天状态
│   │   ├── useWorkspaceStore.ts   # Zustand: 工作区状态
│   │   ├── atoms.ts               # Jotai: 原子状态
│   │   └── useAgentStore.ts       # Zustand: Agent 状态
│   │
│   ├── hooks/                     # 自定义 Hooks
│   │   ├── useResizable.ts
│   │   ├── useElectronIPC.ts
│   │   ├── useAgent.ts
│   │   └── useKeyboardShortcuts.ts
│   │
│   ├── services/                  # API 服务
│   │   ├── api.ts                 # Axios 实例
│   │   ├── agent-service.ts       # Agent API
│   │   ├── model-service.ts       # 模型 API
│   │   └── file-service.ts        # 文件操作
│   │
│   ├── types/                     # TypeScript 类型
│   │   ├── agent.ts
│   │   ├── chat.ts
│   │   ├── workspace.ts
│   │   └── electron.d.ts
│   │
│   └── styles/
│       └── globals.css            # Tailwind CSS 4 入口
```

---

## 🧩 核心代码实现

### 1. 根布局 - `RootLayout.tsx`

```tsx
// src/renderer/layouts/RootLayout.tsx
import { useState, useCallback } from 'react'
import { Outlet } from 'react-router'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { TitleBar } from './TitleBar'
import { StatusBar } from './StatusBar'
import { ActivityBar } from '@/components/sidebar/ActivityBar'
import { SecondarySidebar } from '@/components/sidebar/SecondarySidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { BottomPanel } from '@/components/bottom-panel/BottomPanel'
import { useAppStore } from '@/stores/useAppStore'

export function RootLayout() {
  const { 
    sidebarVisible, 
    chatPanelVisible, 
    bottomPanelVisible,
    activeSidebarTab 
  } = useAppStore()

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 自定义标题栏 - Electron 无边框窗口 */}
      <TitleBar />

      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 最左侧 Activity Bar (图标导航) */}
        <ActivityBar />

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* 二级侧边栏 - 可折叠 */}
          {sidebarVisible && (
            <>
              <ResizablePanel
                defaultSize={18}
                minSize={12}
                maxSize={30}
                collapsible
                collapsedSize={0}
              >
                <SecondarySidebar activeTab={activeSidebarTab} />
              </ResizablePanel>
              <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
            </>
          )}

          {/* 中央主工作区 + 底部面板 */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={75} minSize={40}>
                <Outlet /> {/* React Router 渲染的页面 */}
              </ResizablePanel>

              {bottomPanelVisible && (
                <>
                  <ResizableHandle withHandle className="h-1 bg-border hover:bg-primary/50 transition-colors" />
                  <ResizablePanel defaultSize={25} minSize={10} maxSize={50} collapsible collapsedSize={0}>
                    <BottomPanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* 右侧 AI Chat 面板 */}
          {chatPanelVisible && (
            <>
              <ResizableHandle withHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
              <ResizablePanel defaultSize={32} minSize={20} maxSize={50} collapsible collapsedSize={0}>
                <ChatPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* 底部状态栏 */}
      <StatusBar />
    </div>
  )
}
```

### 2. 自定义标题栏 - `TitleBar.tsx`

```tsx
// src/renderer/layouts/TitleBar.tsx
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/useAppStore'
import {
  Minus,
  Square,
  X,
  Maximize2,
  PanelLeftClose,
  PanelRightClose,
  PanelBottom,
  Settings,
  Search,
} from 'lucide-react'

type WorkMode = 'work' | 'code' | 'design'

export function TitleBar() {
  const { 
    activeMode, setActiveMode, 
    toggleSidebar, toggleChatPanel, toggleBottomPanel 
  } = useAppStore()

  const handleMinimize = () => window.electronAPI?.windowControl('minimize')
  const handleMaximize = () => window.electronAPI?.windowControl('maximize')
  const handleClose = () => window.electronAPI?.windowControl('close')

  const modes: { key: WorkMode; label: string; icon: string }[] = [
    { key: 'work', label: 'Work', icon: '💼' },
    { key: 'code', label: 'Code', icon: '⚡' },
    { key: 'design', label: 'Design', icon: '🎨' },
  ]

  return (
    <header
      className={cn(
        "flex items-center h-10 border-b border-border bg-background/95 backdrop-blur",
        "select-none drag-region" // Electron 拖拽区域
      )}
    >
      {/* 左侧控制按钮 */}
      <div className="flex items-center gap-1 px-2 no-drag">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleSidebar}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>

        {/* 模式切换器 */}
        <div className="flex items-center bg-muted rounded-lg p-0.5 ml-2">
          {modes.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveMode(key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                activeMode === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* 中央 - 项目名 + 搜索 */}
      <div className="flex-1 flex items-center justify-center gap-2 no-drag">
        <span className="text-sm font-medium text-muted-foreground">
          My AI Agent Project
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground gap-1">
          <Search className="h-3 w-3" />
          <span>搜索</span>
          <kbd className="ml-1 px-1 bg-muted rounded text-[10px]">⌘K</kbd>
        </Button>
      </div>

      {/* 右侧窗口控制 */}
      <div className="flex items-center gap-1 px-2 no-drag">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleBottomPanel}>
          <PanelBottom className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleChatPanel}>
          <PanelRightClose className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings className="h-4 w-4" />
        </Button>

        {/* Electron 窗口控制按钮 */}
        <div className="flex items-center ml-2 gap-0.5">
          <button onClick={handleMinimize} className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleMaximize} className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted">
            <Maximize2 className="h-3 w-3" />
          </button>
          <button onClick={handleClose} className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-500 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
```

### 3. Activity Bar (图标导航栏) - `ActivityBar.tsx`

```tsx
// src/renderer/components/sidebar/ActivityBar.tsx
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Files,
  Search,
  GitBranch,
  Wrench,
  History,
  Blocks,
  MessageSquare,
  Image,
  FolderOpen,
} from 'lucide-react'

const navItems = [
  { id: 'files', icon: Files, label: '文件浏览器', shortcut: '⌘1' },
  { id: 'search', icon: Search, label: '全局搜索', shortcut: '⌘2' },
  { id: 'git', icon: GitBranch, label: '版本控制', shortcut: '⌘3' },
  { id: 'tools', icon: Wrench, label: '工具集', shortcut: '⌘4' },
  { id: 'skills', icon: Blocks, label: 'Skills 技能', shortcut: '⌘5' },
  { id: 'history', icon: History, label: '历史记录', shortcut: '⌘6' },
  { id: 'assets', icon: Image, label: '资源管理', shortcut: '⌘7' },
]

const bottomItems = [
  { id: 'chat', icon: MessageSquare, label: 'AI 对话', shortcut: '⌘B' },
  { id: 'folder', icon: FolderOpen, label: '打开文件夹', shortcut: '' },
]

export function ActivityBar() {
  const { activeSidebarTab, setActiveSidebarTab, toggleSidebar } = useAppStore()

  const handleClick = (id: string) => {
    if (activeSidebarTab === id) {
      toggleSidebar() // 再次点击折叠
    } else {
      setActiveSidebarTab(id)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <nav className="flex flex-col items-center w-12 bg-sidebar border-r border-border py-2 justify-between shrink-0">
        {/* 上部导航 */}
        <div className="flex flex-col items-center gap-1">
          {navItems.map(({ id, icon: Icon, label, shortcut }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleClick(id)}
                  className={cn(
                    "relative flex items-center justify-center w-9 h-9 rounded-lg transition-all",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    activeSidebarTab === id
                      ? "text-foreground bg-sidebar-accent"
                      : "text-muted-foreground"
                  )}
                >
                  {/* 激活指示器 */}
                  {activeSidebarTab === id && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />
                  )}
                  <Icon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="flex items-center gap-2">
                <span>{label}</span>
                {shortcut && (
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                    {shortcut}
                  </kbd>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* 下部操作 */}
        <div className="flex flex-col items-center gap-1">
          {bottomItems.map(({ id, icon: Icon, label }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleClick(id)}
                  className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-lg transition-all",
                    "hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}

          {/* 用户头像 */}
          <div className="mt-2 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xs font-medium text-primary">U</span>
          </div>
        </div>
      </nav>
    </TooltipProvider>
  )
}
```

### 4. AI Chat 面板 - `ChatPanel.tsx`

```tsx
// src/renderer/components/chat/ChatPanel.tsx
import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/useChatStore'
import { MessageBubble } from './MessageBubble'
import { ChatInput } from './ChatInput'
import { AgentStatus } from './AgentStatus'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, Settings2, ChevronDown, Sparkles } from 'lucide-react'

export function ChatPanel() {
  const { 
    messages, 
    isAgentRunning, 
    activeConversation,
    conversations,
    currentModel 
  } = useChatStore()
  
  const scrollRef = useRef<HTMLDivElement>(null)

  // 新消息自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-chat-panel border-l border-border">
      {/* Chat 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-sm font-medium hover:bg-muted px-2 py-1 rounded">
                {activeConversation?.title || '新对话'}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {conversations.map((conv) => (
                <DropdownMenuItem key={conv.id}>
                  {conv.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1">
          {/* 模型选择器 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {currentModel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>GPT-4o</DropdownMenuItem>
              <DropdownMenuItem>Claude Sonnet 4</DropdownMenuItem>
              <DropdownMenuItem>DeepSeek V3</DropdownMenuItem>
              <DropdownMenuItem>Qwen Max</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1 px-3" ref={scrollRef}>
        <div className="flex flex-col gap-4 py-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Agent 执行状态指示器 */}
          {isAgentRunning && <AgentStatus />}
        </div>
      </ScrollArea>

      {/* 输入区域 */}
      <ChatInput />
    </div>
  )
}
```

### 5. 消息气泡 + Markdown 渲染 - `MessageBubble.tsx`

```tsx
// src/renderer/components/chat/MessageBubble.tsx
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Copy, RefreshCw, ThumbsUp, ThumbsDown, Bot, User } from 'lucide-react'
import { ToolCallCard } from './ToolCallCard'
import { ThinkingBlock } from './ThinkingBlock'
import type { Message } from '@/types/chat'

interface Props {
  message: Message
}

export const MessageBubble = memo(function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  return (
    <div className={cn("flex gap-3 group", isUser && "flex-row-reverse")}>
      {/* 头像 */}
      <Avatar className="h-7 w-7 shrink-0 mt-1">
        <AvatarFallback className={cn(
          "text-xs",
          isUser ? "bg-blue-500/20 text-blue-600" : "bg-primary/20 text-primary"
        )}>
          {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </AvatarFallback>
      </Avatar>

      {/* 消息内容 */}
      <div className={cn("flex flex-col gap-2 max-w-[85%]", isUser && "items-end")}>
        {/* 思考过程 (折叠) */}
        {message.thinking && <ThinkingBlock content={message.thinking} />}

        {/* 工具调用卡片 */}
        {message.toolCalls?.map((tool) => (
          <ToolCallCard key={tool.id} toolCall={tool} />
        ))}

        {/* Markdown 正文 */}
        {message.content && (
          <div className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-blue-600 text-white"
              : "bg-muted/60 text-foreground"
          )}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              className="prose prose-sm dark:prose-invert max-w-none
                prose-pre:bg-zinc-900 prose-pre:rounded-lg prose-pre:p-3
                prose-code:text-primary prose-code:before:content-none prose-code:after:content-none
                prose-a:text-blue-500 prose-headings:text-foreground
                prose-p:my-1 prose-ul:my-1 prose-ol:my-1"
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* 操作按钮 (仅 AI 消息 hover 显示) */}
        {isAssistant && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Copy className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <RefreshCw className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <ThumbsDown className="h-3 w-3" />
            </Button>
            <span className="text-[10px] text-muted-foreground ml-1">
              {message.tokenUsage?.total ?? 0} tokens
            </span>
          </div>
        )}
      </div>
    </div>
  )
})
```

### 6. 输入框组件 - `ChatInput.tsx`

```tsx
// src/renderer/components/chat/ChatInput.tsx
import { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatStore } from '@/stores/useChatStore'
import {
  Paperclip,
  Mic,
  Send,
  StopCircle,
  AtSign,
  Zap,
  Image,
  FileText,
} from 'lucide-react'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'

export function ChatInput() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, stopGeneration, isAgentRunning } = useChatStore()

  const handleSend = useCallback(() => {
    if (!input.trim() || isAgentRunning) return
    sendMessage(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isAgentRunning, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="shrink-0 border-t border-border bg-background">
      {/* 快捷操作提示 */}
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto scrollbar-none">
        {['分析代码', '生成文档', '修复 Bug', '写测试', '解释错误'].map((hint) => (
          <button
            key={hint}
            onClick={() => setInput(hint)}
            className="shrink-0 px-2.5 py-1 text-[11px] rounded-full bg-muted 
                       text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            {hint}
          </button>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="px-3 pb-3">
        <div className="relative flex items-end bg-muted/50 rounded-xl border border-border focus-within:border-primary/50 transition-colors">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的需求，AI 将自动拆解任务并执行..."
            className="flex-1 min-h-[44px] max-h-[160px] resize-none border-0 bg-transparent 
                       px-4 py-3 text-sm focus-visible:ring-0 placeholder:text-muted-foreground/60"
          />

          {/* 底部工具栏 */}
          <div className="flex items-center gap-0.5 px-2 pb-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>附加文件</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                    <AtSign className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>@提及工具/Skill</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                    <Zap className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Agent 模式</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* 发送/停止按钮 */}
            {isAgentRunning ? (
              <Button
                size="icon"
                variant="destructive"
                className="h-7 w-7 rounded-lg"
                onClick={stopGeneration}
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-lg"
                disabled={!input.trim()}
                onClick={handleSend}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

### 7. Agent 执行状态 - `AgentStatus.tsx`

```tsx
// src/renderer/components/chat/AgentStatus.tsx
import { useAgentStore } from '@/stores/useAgentStore'
import { cn } from '@/lib/utils'
import { Loader2, CheckCircle2, Circle, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function AgentStatus() {
  const { steps, currentStepIndex, status } = useAgentStore()
  const [isOpen, setIsOpen] = useState(true)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-4 py-2.5 hover:bg-muted/50 transition-colors">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
          <span className="text-sm font-medium flex-1 text-left">
            Agent 正在执行任务...
          </span>
          <span className="text-xs text-muted-foreground">
            {currentStepIndex + 1}/{steps.length} 步
          </span>
          <ChevronRight className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isOpen && "rotate-90"
          )} />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-3 space-y-2">
            {steps.map((step, i) => (
              <div key={step.id} className="flex items-start gap-2">
                {i < currentStepIndex ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                ) : i === currentStepIndex ? (
                  <Loader2 className="h-4 w-4 text-primary animate-spin mt-0.5 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-xs",
                    i <= currentStepIndex ? "text-foreground" : "text-muted-foreground/60"
                  )}>
                    {step.description}
                  </p>
                  {step.toolName && (
                    <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded bg-primary/10 text-primary">
                      🔧 {step.toolName}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
```

### 8. 状态管理 - Zustand + Jotai

```tsx
// src/renderer/stores/useAppStore.ts
import { create } from 'zustand'

type WorkMode = 'work' | 'code' | 'design'
type SidebarTab = 'files' | 'search' | 'git' | 'tools' | 'skills' | 'history' | 'assets' | 'chat' | 'folder'

interface AppState {
  // 布局可见性
  sidebarVisible: boolean
  chatPanelVisible: boolean
  bottomPanelVisible: boolean
  
  // 模式 & 标签
  activeMode: WorkMode
  activeSidebarTab: SidebarTab

  // Actions
  toggleSidebar: () => void
  toggleChatPanel: () => void
  toggleBottomPanel: () => void
  setActiveMode: (mode: WorkMode) => void
  setActiveSidebarTab: (tab: SidebarTab) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarVisible: true,
  chatPanelVisible: true,
  bottomPanelVisible: false,
  activeMode: 'work',
  activeSidebarTab: 'files',

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleChatPanel: () => set((s) => ({ chatPanelVisible: !s.chatPanelVisible })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),
  setActiveMode: (mode) => set({ activeMode: mode }),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab, sidebarVisible: true }),
}))
```

```tsx
// src/renderer/stores/useChatStore.ts
import { create } from 'zustand'
import type { Message, Conversation } from '@/types/chat'

interface ChatState {
  messages: Message[]
  conversations: Conversation[]
  activeConversation: Conversation | null
  isAgentRunning: boolean
  currentModel: string

  sendMessage: (content: string) => void
  stopGeneration: () => void
  setModel: (model: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversations: [],
  activeConversation: null,
  isAgentRunning: false,
  currentModel: 'Claude Sonnet 4',

  sendMessage: async (content) => {
    // 添加用户消息
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      isAgentRunning: true,
    }))

    // 调用 Agent API (此处为示意)
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ message: content }),
      })
      // 处理流式响应...
    } finally {
      set({ isAgentRunning: false })
    }
  },

  stopGeneration: () => set({ isAgentRunning: false }),
  setModel: (model) => set({ currentModel: model }),
}))
```

```tsx
// src/renderer/stores/atoms.ts — Jotai 原子状态（适合细粒度 UI 状态）
import { atom } from 'jotai'

// 面板尺寸（Jotai 适合存储这种频繁独立读写的状态）
export const sidebarWidthAtom = atom(260)
export const chatPanelWidthAtom = atom(380)
export const bottomPanelHeightAtom = atom(200)

// 当前编辑器内光标位置等临时 UI 状态
export const cursorPositionAtom = atom({ line: 1, column: 1 })

// 搜索面板状态
export const searchQueryAtom = atom('')
export const searchResultsAtom = atom<SearchResult[]>([])

// Agent 任务进度 (全局浮窗提示用)
export const agentProgressAtom = atom<number | null>(null)
```

### 9. 主工作区页面 - `WorkspacePage.tsx`

```tsx
// src/renderer/pages/WorkspacePage.tsx
import { useAppStore } from '@/stores/useAppStore'
import { TabBar } from '@/components/workspace/TabBar'
import { CodeEditor } from '@/components/workspace/CodeEditor'
import { PreviewPanel } from '@/components/workspace/PreviewPanel'
import { DesignCanvas } from '@/components/workspace/DesignCanvas'
import { WelcomePage } from '@/components/workspace/WelcomePage'
import { useWorkspaceStore } from '@/stores/useWorkspaceStore'

export function WorkspacePage() {
  const { activeMode } = useAppStore()
  const { openFiles, activeFile } = useWorkspaceStore()

  // 没有打开文件时显示欢迎页
  if (openFiles.length === 0) {
    return <WelcomePage />
  }

  return (
    <div className="flex flex-col h-full">
      <TabBar />

      <div className="flex-1 overflow-hidden">
        {activeMode === 'code' && <CodeEditor file={activeFile} />}
        {activeMode === 'work' && <PreviewPanel file={activeFile} />}
        {activeMode === 'design' && <DesignCanvas />}
      </div>
    </div>
  )
}
```

### 10. 底部状态栏 - `StatusBar.tsx`

```tsx
// src/renderer/layouts/StatusBar.tsx
import { useAgentStore } from '@/stores/useAgentStore'
import { useAppStore } from '@/stores/useAppStore'
import { useAtom } from 'jotai'
import { cursorPositionAtom } from '@/stores/atoms'
import { cn } from '@/lib/utils'
import {
  GitBranch,
  Wifi,
  WifiOff,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react'

export function StatusBar() {
  const { activeMode } = useAppStore()
  const { status } = useAgentStore()
  const [cursor] = useAtom(cursorPositionAtom)

  const modeLabels = { work: 'Work', code: 'Code', design: 'Design' }
  const modeColors = { work: 'bg-blue-500', code: 'bg-green-500', design: 'bg-purple-500' }

  return (
    <footer className="flex items-center h-6 px-2 bg-primary text-primary-foreground text-[11px] shrink-0 select-none">
      {/* 左侧 */}
      <div className="flex items-center gap-3 flex-1">
        <span className="flex items-center gap-1">
          <span className={cn("w-2 h-2 rounded-full", modeColors[activeMode])} />
          {modeLabels[activeMode]}
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          main
        </span>
        {status === 'running' && (
          <span className="flex items-center gap-1 animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" />
            Agent 执行中
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1 text-yellow-300">
            <AlertCircle className="h-3 w-3" />
            Agent 错误
          </span>
        )}
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-3 flex-1 justify-end">
        <span>行 {cursor.line}, 列 {cursor.column}</span>
        <span>UTF-8</span>
        <span>
          <Zap className="h-3 w-3 inline mr-0.5" />
          12,340 tokens
        </span>
        <span className="flex items-center gap-1">
          <Wifi className="h-3 w-3" />
          已连接
        </span>
      </div>
    </footer>
  )
}
```

### 11. Electron 主进程配置

```ts
// src/main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,              // 无边框窗口 → 自定义 TitleBar
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#09090b',       // 与背景色一致
      symbolColor: '#a1a1aa',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#09090b',
  })

  // 开发模式加载 Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 窗口控制 IPC
  ipcMain.handle('window:control', (_, action: string) => {
    switch (action) {
      case 'minimize':  mainWindow?.minimize(); break
      case 'maximize':  mainWindow?.isMaximized() 
                          ? mainWindow?.unmaximize() 
                          : mainWindow?.maximize(); break
      case 'close':     mainWindow?.close(); break
    }
  })
}

app.whenReady().then(createWindow)
```

---

## 🎨 设计要点总结

| 设计维度 | 方案说明 |
|---|---|
| **布局系统** | `ResizablePanelGroup` (shadcn/ui) 实现三栏自由拖拽调整宽度，支持面板折叠/展开 |
| **标题栏** | Electron `frame: false` + 自定义 TitleBar，集成 Work/Code/Design 模式切换 |
| **左侧导航** | 双层结构：ActivityBar (48px 图标栏) + SecondarySidebar (文件树/搜索/工具) |
| **AI 对话面板** | 右侧固定面板，支持 Markdown 渲染、工具调用卡片、Agent 步骤可视化 |
| **状态管理** | **Zustand** 管理业务数据（聊天、Agent、工作区）；**Jotai** 管理细粒度 UI 状态（面板尺寸、光标位置） |
| **主题** | Tailwind CSS 4 + CSS Variables，支持 Dark/Light 主题，shadcn/ui 统一设计语言 |
| **路由** | React Router v7，`/` → 欢迎页，`/workspace` → 工作区，`/settings` → 设置 |
| **快捷键** | `⌘B` 切换聊天面板，`⌘1-7` 切换侧边栏 Tab，`⌘J` 底部面板，`⌘K` 全局搜索 |
| **Electron IPC** | 窗口控制、文件系统访问、系统通知等通过 preload 桥接 |

### 关键交互流程

```
用户输入需求 → ChatInput → sendMessage()
    ↓
Agent 自动拆解任务 → useAgentStore 更新 steps
    ↓
AgentStatus 实时展示步骤进度（思考 → 调用工具 → 生成结果）
    ↓
工具调用结果 → ToolCallCard 卡片展示（代码变更/文件生成/命令执行）
    ↓
最终结果 → MessageBubble (react-markdown) 渲染 + Workspace 同步更新
```

这套布局完全对标 Trae Work 的设计语言，同时利用你的技术栈实现了高度可定制、可拖拽调整的专业级 AI Agent 工作台。如果你需要我进一步展开某个模块的详细实现（比如 Agent 工具调用卡片、代码编辑器集成、或 Electron IPC 通信），可以告诉我！