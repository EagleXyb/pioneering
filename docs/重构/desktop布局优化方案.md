# 类 Codex / Cursor 三栏布局 AI Agent 工作台设计

这是一个非常经典的 **AI Agent 三栏布局**：
- **左栏 (Sidebar)**：会话历史、项目导航、文件树。
- **中栏 (Chat)**：核心对话流（Markdown 渲染）+ 输入框。
- **右栏 (Context Panel)**：上下文预览、代码 Diff、Agent 沙箱终端、工具调用结果。

基于你的技术栈（Electron 42 + React 19 + shadcn/ui 等），以下是完整的架构设计与核心代码实现。

---

## 📐 1. 三栏布局架构图

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Electron TitleBar (自定义拖拽区 + 模式切换 Work/Code/Design + 窗口控制)  │
├────────────┬─────────────────────────────────────┬──────────────────────┤
│            │                                     │                      │
│  Sidebar   │          Chat Area                  │   Context Panel      │
│  (左栏)    │          (中栏)                     │   (右栏)             │
│            │                                     │                      │
│ ┌────────┐ │  ┌─────────────────────────────┐    │  ┌────────────────┐  │
│ │Search  │ │  │                             │    │  │ Tab: Code |    │  │
│ │History │ │  │      Messages Stream        │    │  │ Terminal | Diff│  │
│ │Files   │ │  │      (react-markdown)       │    │  │                │  │
│ │Settings│ │  │                             │    │  │  (预览区/沙箱)  │  │
│ │        │ │  │                             │    │  │                │  │
│ │        │ │  └─────────────────────────────┘    │  └────────────────┘  │
│ │        │ │                                     │                      │
│ │        │ │  ┌─────────────────────────────┐    │                      │
│ │        │ │  │       Input Bar             │    │                      │
│ └────────┘ │  └─────────────────────────────┘    │                      │
├────────────┴─────────────────────────────────────┴──────────────────────┤
│  Status Bar (Agent 状态 | Token | 分支 | 模型)                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 2. 项目目录结构

```text
src/
├── main/                           # Electron 主进程
├── preload/                        # Preload 脚本
├── renderer/                       # React 渲染进程
│   ├── layouts/
│   │   ├── RootLayout.tsx          # 🌟 三栏 Resizable 根布局
│   │   ├── TitleBar.tsx            # 自定义标题栏
│   │   └── StatusBar.tsx           # 底部状态栏
│   ├── components/
│   │   ├── sidebar/                # 左栏
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ConversationList.tsx
│   │   │   └── FileTree.tsx
│   │   ├── chat/                   # 中栏
│   │   │   ├── ChatArea.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx   # react-markdown 渲染
│   │   │   └── ChatInput.tsx
│   │   ├── context-panel/          # 右栏
│   │   │   ├── ContextPanel.tsx
│   │   │   ├── CodePreview.tsx
│   │   │   ├── TerminalView.tsx
│   │   │   └── DiffViewer.tsx
│   │   └── ui/                     # shadcn/ui 组件
│   ├── stores/
│   │   ├── useAppStore.ts          # Zustand: 全局/业务状态
│   │   ├── useChatStore.ts         # Zustand: 对话数据
│   │   └── atoms.ts                # Jotai: UI 细粒度状态(面板宽度等)
│   ├── hooks/
│   │   ├── usePlatform.ts          # 跨平台检测
│   │   └── useShortcuts.ts         # 快捷键
│   └── styles/
│       └── globals.css             # Tailwind CSS 4 入口
```

---

## 🧩 3. 核心代码实现

### 3.1 三栏根布局 (`RootLayout.tsx`)
使用 shadcn/ui 的 `Resizable` 组件实现三栏自由拖拽，并结合 Jotai 持久化面板宽度。

```tsx
// src/renderer/layouts/RootLayout.tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatArea } from '@/components/chat/ChatArea'
import { ContextPanel } from '@/components/context-panel/ContextPanel'
import { TitleBar } from './TitleBar'
import { StatusBar } from './StatusBar'
import { useAtom } from 'jotai'
import { sidebarWidthAtom, contextPanelWidthAtom } from '@/stores/atoms'

export function RootLayout() {
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom)
  const [contextWidth, setContextWidth] = useAtom(contextPanelWidthAtom)

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleBar />

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* 左栏：Sidebar */}
        <ResizablePanel
          defaultSize={sidebarWidth}
          minSize={10}
          maxSize={25}
          collapsible
          collapsedSize={3}
          onResize={(size) => setSidebarWidth(size)}
        >
          <Sidebar />
        </ResizablePanel>

        <ResizableHandle withHandle className="w-px bg-border hover:bg-primary/50 transition-colors" />

        {/* 中栏：Chat Area */}
        <ResizablePanel defaultSize={100 - sidebarWidth - contextWidth} minSize={30}>
          <ChatArea />
        </ResizablePanel>

        <ResizableHandle withHandle className="w-px bg-border hover:bg-primary/50 transition-colors" />

        {/* 右栏：Context Panel */}
        <ResizablePanel
          defaultSize={contextWidth}
          minSize={15}
          maxSize={50}
          collapsible
          collapsedSize={0}
          onResize={(size) => setContextWidth(size)}
        >
          <ContextPanel />
        </ResizablePanel>
      </ResizablePanelGroup>

      <StatusBar />
    </div>
  )
}
```

### 3.2 左栏：侧边栏 (`Sidebar.tsx`)
包含会话历史、文件树等，采用 Tab 或手风琴折叠。

```tsx
// src/renderer/components/sidebar/Sidebar.tsx
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageSquare, FolderTree, Plus, Settings } from 'lucide-react'
import { useChatStore } from '@/stores/useChatStore'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const { conversations, activeConversationId, createConversation } = useChatStore()

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-border">
      {/* 顶部操作区 */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h2 className="text-sm font-semibold">AI Agent</h2>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={createConversation}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* 会话列表 */}
      <ScrollArea className="flex-1 px-2 py-2">
        <div className="space-y-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors text-left",
                activeConversationId === conv.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="truncate">{conv.title}</span>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* 底部工具 */}
      <div className="p-2 border-t border-border flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-2 text-xs">
          <FolderTree className="h-4 w-4" /> 文件树
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
```

### 3.3 中栏：对话区 (`ChatArea.tsx`)
核心交互区，包含消息流和输入框。

```tsx
// src/renderer/components/chat/ChatArea.tsx
import { useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MessageBubble } from './MessageBubble'
import { ChatInput } from './ChatInput'
import { useChatStore } from '@/stores/useChatStore'
import { Bot } from 'lucide-react'

export function ChatArea() {
  const { messages, isAgentRunning } = useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isAgentRunning])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 消息流 */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">How can I help you today?</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Ask me to write code, debug issues, or automate your workflow.
              </p>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <div className="border-t border-border bg-background">
        <div className="max-w-3xl mx-auto p-4">
          <ChatInput />
        </div>
      </div>
    </div>
  )
}
```

### 3.4 消息气泡与 Markdown 渲染 (`MessageBubble.tsx`)
使用 `react-markdown` 渲染 AI 回复，支持代码高亮和工具调用卡片。

```tsx
// src/renderer/components/chat/MessageBubble.tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Bot, User } from 'lucide-react'
import type { Message } from '@/types/chat'

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn("flex gap-4", isUser && "flex-row-reverse")}>
      <Avatar className="h-8 w-8 shrink-0 mt-1">
        <AvatarFallback className={cn(
          "text-xs",
          isUser ? "bg-blue-500/20 text-blue-600" : "bg-primary/20 text-primary"
        )}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex-1 min-w-0", isUser && "flex justify-end")}>
        <div className={cn(
          "inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/50 text-foreground"
        )}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              className="prose prose-sm dark:prose-invert max-w-none
                prose-pre:bg-zinc-900 prose-pre:rounded-lg prose-pre:p-3
                prose-code:text-primary prose-code:before:content-none prose-code:after:content-none"
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  )
}
```

### 3.5 右栏：上下文面板 (`ContextPanel.tsx`)
用于展示 Agent 生成的代码、Diff、或终端输出（类似 Codex 的 Canvas/Artifact）。

```tsx
// src/renderer/components/context-panel/ContextPanel.tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CodePreview } from './CodePreview'
import { TerminalView } from './TerminalView'
import { FileCode, Terminal, GitCompare } from 'lucide-react'

export function ContextPanel() {
  return (
    <div className="flex flex-col h-full bg-muted/20 border-l border-border">
      <Tabs defaultValue="code" className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-border bg-background">
          <TabsList className="h-8 bg-muted/50">
            <TabsTrigger value="code" className="text-xs gap-1.5 h-6 px-2">
              <FileCode className="h-3.5 w-3.5" /> Code
            </TabsTrigger>
            <TabsTrigger value="diff" className="text-xs gap-1.5 h-6 px-2">
              <GitCompare className="h-3.5 w-3.5" /> Diff
            </TabsTrigger>
            <TabsTrigger value="terminal" className="text-xs gap-1.5 h-6 px-2">
              <Terminal className="h-3.5 w-3.5" /> Terminal
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="code" className="flex-1 overflow-hidden mt-0">
          <CodePreview />
        </TabsContent>
        <TabsContent value="diff" className="flex-1 overflow-hidden mt-0">
          <div className="p-4 text-sm text-muted-foreground">Diff Viewer (集成 monaco-editor)</div>
        </TabsContent>
        <TabsContent value="terminal" className="flex-1 overflow-hidden mt-0">
          <TerminalView />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

---

## 🧠 4. 状态管理策略 (Zustand + Jotai)

在三栏布局中，状态分为**业务数据**和**UI 状态**，合理分工能大幅提升性能：

### Zustand (管理业务/全局状态)
```tsx
// src/renderer/stores/useChatStore.ts
import { create } from 'zustand'
import type { Message, Conversation } from '@/types/chat'

interface ChatState {
  messages: Message[]
  conversations: Conversation[]
  activeConversationId: string | null
  isAgentRunning: boolean
  
  createConversation: () => void
  sendMessage: (content: string) => Promise<void>
  appendAgentMessage: (chunk: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversations: [],
  activeConversationId: null,
  isAgentRunning: false,
  
  createConversation: () => { /* ... */ },
  sendMessage: async (content) => { /* 调用 Axios 发送流式请求 */ },
  appendAgentMessage: (chunk) => { /* 处理 SSE 流式追加 */ },
}))
```

### Jotai (管理 UI 细粒度状态)
```tsx
// src/renderer/stores/atoms.ts
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// 面板宽度 (持久化到 localStorage)
export const sidebarWidthAtom = atomWithStorage('sidebar-width', 15)
export const contextPanelWidthAtom = atomWithStorage('context-width', 35)

// 右栏当前激活的文件/上下文
export const activeContextFileAtom = atom<string | null>(null)

// 主题模式
export const themeAtom = atomWithStorage('theme', 'system')
```

---

## 💻 5. Electron 跨平台适配要点

为了让这套布局在 Mac 和 Windows 上都表现完美，需要在主进程和 UI 层做差异化处理：

### 主进程窗口配置 (`main/index.ts`)
```typescript
const isMac = process.platform === 'darwin'

const win = new BrowserWindow({
  width: 1440,
  height: 900,
  frame: isMac ? true : false,
  titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
  titleBarOverlay: isMac ? false : {
    color: '#09090b',
    symbolColor: '#a1a1aa',
    height: 40,
  },
  trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
  // ...
})
```

### UI 层平台检测 Hook
```tsx
// src/renderer/hooks/usePlatform.ts
export function usePlatform() {
  const platform = window.electronAPI?.platform || 'win32'
  return {
    isMac: platform === 'darwin',
    isWindows: platform === 'win32',
    modKey: platform === 'darwin' ? '⌘' : 'Ctrl',
  }
}
```

### 标题栏适配 (`TitleBar.tsx`)
```tsx
export function TitleBar() {
  const { isMac, isWindows } = usePlatform()
  
  return (
    <header className="flex items-center h-10 border-b border-border drag-region select-none">
      {/* Mac 左侧红绿灯留白 */}
      {isMac && <div className="w-[70px]" />}
      
      {/* 中间内容 */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm font-medium">AI Agent Workspace</span>
      </div>
      
      {/* Windows 右侧控制按钮 */}
      {isWindows && <WindowControls />}
    </header>
  )
}
```

---

## 🎨 6. 设计亮点总结

| 特性 | 实现方案 |
|---|---|
| **三栏自由拖拽** | 使用 shadcn/ui 的 `ResizablePanelGroup`，支持面板折叠（Collapsible）和最小宽度限制。 |
| **流式 Markdown 渲染** | `react-markdown` + `rehype-highlight`，配合 Zustand 的 `appendAgentMessage` 实现打字机效果。 |
| **上下文联动** | 当 AI 生成代码或修改文件时，右栏 `ContextPanel` 自动切换到 Diff 或 Code 视图，展示变更。 |
| **状态持久化** | 使用 Jotai 的 `atomWithStorage` 记住用户调整的面板宽度和主题偏好。 |
| **跨平台一致性** | 通过 `usePlatform` Hook 动态渲染标题栏、快捷键提示（⌘ vs Ctrl），确保 Mac/Win 原生体验。 |

