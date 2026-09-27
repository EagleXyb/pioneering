// ============================================================
// RightPanel — 右侧集成面板容器（标签栏 + 内容区）
// ============================================================
// 取代原 ContextPanel：把「单一视图切换 + 产物覆盖层」改为「多标签容器」。
//   - 标签栏：PanelTabBar（菜单 / 标签 / 新建 / 最大化 / 收起）
//   - 内容区：按激活标签的 kind 渲染，切换标签即切换内容
//   - 无标签时显示空态，引导通过标签栏的 + 新建
//
// 渲染策略（keep-alive）：
//   - 任务类标签（任务监控 / 任务流水线）保留挂载、仅切换显隐 ——
//     切换标签时展开态与滚动位置不丢失；
//   - 产物标签按需渲染 —— 预览内容可能包含 iframe（HTML/SVG），
//     常驻会持续占用资源，故仅在激活时挂载。
//
// 三栏模式与覆盖模式（Drawer）共用本组件。由于标签状态全部位于 atom，
// 两种布局下的两个实例天然同步 —— 原 ContextPanel 用组件内 useState
// 导致的双实例不同步问题一并消除。
// ============================================================

import { useAtomValue } from 'jotai'
import { PanelRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PanelTabBar } from './PanelTabBar'
import { TaskPipelineTab } from './TaskPipelineTab'
import { TaskMonitor } from './TaskMonitor'
import { ArtifactPanel } from '@/components/preview/ArtifactPanel'
import { rightPanelActiveTabIdAtom, rightPanelTabsAtom } from '@/stores/rightPanelStore'

export function RightPanel() {
  const tabs = useAtomValue(rightPanelTabsAtom)
  const activeId = useAtomValue(rightPanelActiveTabIdAtom)

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <PanelTabBar />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.length === 0 ? (
          <EmptyPanelState />
        ) : (
          tabs.map((tab) => {
            const isActive = tab.id === activeId

            // 产物标签：仅激活时挂载（避免 iframe 常驻占用资源）
            if (tab.kind === 'preview') {
              return isActive ? (
                <div key={tab.id} className="h-full">
                  <ArtifactPanel />
                </div>
              ) : null
            }

            // 任务类标签：保留挂载，仅切换显隐（保留展开态与滚动位置）
            return (
              <div key={tab.id} className={cn('h-full', !isActive && 'hidden')}>
                {tab.kind === 'pipeline' ? <TaskPipelineTab /> : <TaskMonitor />}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** 无标签时的空态 */
function EmptyPanelState() {
  return (
    <div className="flex h-full select-none flex-col items-center justify-center gap-2">
      <PanelRight className="size-8 text-muted-foreground/30" strokeWidth={1.5} />
      <p className="text-[13px] text-muted-foreground/70">暂无打开的标签</p>
      <p className="text-[11px] text-muted-foreground/50">点击标签栏的 + 新建</p>
    </div>
  )
}
