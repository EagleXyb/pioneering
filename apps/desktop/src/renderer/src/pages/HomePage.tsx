// ============================================================
// Pages
// ============================================================

// ---- HomePage ----
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Bot, Settings, ArrowRight } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useSetAtom } from 'jotai'
import { settingsOpenAtom } from '../stores/atoms'

export function HomePage() {
  const navigate = useNavigate()
  const setSettingsOpen = useSetAtom(settingsOpenAtom)

  const features = [
    {
      icon: <MessageSquare className="size-10 text-primary" />,
      title: 'AI Chat',
      desc: '对话式 AI 助手，支持流式输出、多模型切换、会话管理',
      path: '/'
    },
    {
      icon: <Bot className="size-10 text-primary" />,
      title: 'AI Agent',
      desc: '智能体执行引擎，支持工具调用、多步推理、任务编排',
      path: '/agent'
    },
    {
      icon: <Settings className="size-10 text-primary" />,
      title: 'Settings',
      desc: '应用配置、模型选择、API 连接管理',
      path: '/settings'
    }
  ]

  return (
    <div className="main-content--welcome h-full overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Welcome Title Bar */}
        <div className="flex items-center justify-between py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground">P</span>
            </div>
            <div>
              <h1 className="text-base font-semibold">Welcome</h1>
              <p className="text-xs text-muted-foreground">Pioneering Desktop</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded bg-muted">v0.1.0</span>
          </div>
        </div>

        {/* Hero */}
        <div className="text-center space-y-4 py-12">
          <h1 className="text-5xl font-bold tracking-tight">
            Pioneering Desktop
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            AI Agent 桌面应用 — 基于 Electron 42 + React 19 + LangGraph
          </p>
          <div className="flex gap-3 justify-center pt-4">
            <Button size="lg" onClick={() => navigate('/')}>
              <MessageSquare className="size-5 mr-2" />
              Start Chat
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate('/agent')}
            >
              <Bot className="size-5 mr-2" />
              Try Agent
            </Button>
          </div>
        </div>

        {/* 功能卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f) => (
            <Card
              key={f.path}
              className="p-6 hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => (f.path === '/settings' ? setSettingsOpen(true) : navigate(f.path))}
            >
              <div className="mb-4">{f.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground mb-4">{f.desc}</p>
              <span className="inline-flex items-center text-sm text-primary font-medium group-hover:gap-2 transition-all">
                Open <ArrowRight className="size-3 ml-1" />
              </span>
            </Card>
          ))}
        </div>

        {/* 技术栈 */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Tech Stack</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              'Electron 42',
              'React 19',
              'TypeScript 5.7',
              'Vite 6',
              'Tailwind CSS 4',
              'Zustand 5',
              'Jotai 2',
              'shadcn/ui',
              'Radix UI',
              'Axios',
              'React Router v7',
              'react-markdown'
            ].map((tech) => (
              <div key={tech} className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted">
                <span className="size-2 rounded-full bg-green-500 shrink-0" />
                <span>{tech}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
