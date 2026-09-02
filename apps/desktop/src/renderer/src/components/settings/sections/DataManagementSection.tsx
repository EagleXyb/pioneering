// ============================================================
// DataManagementSection — 数据管理设置页
// 对齐参考截图样式：
//   · 顶部 Tab 栏（分享的文件 / 分享的任务 / 发布的应用 / 归档的任务）
//   · 选中 Tab：浅灰胶囊背景（圆角 5px，#f0f0f0），文字加粗
//   · 未选中 Tab：透明背景，正常字重，hover 浅灰
//   · 下方内容区：独立圆角卡片（8px 圆角，1px #f0f0f0 边框，白色底）
//   · 空态：卡片内垂直居中显示「暂无xx记录」灰色提示
//
// 与通用/快捷键页保持统一规格：
//   max-width 780 · 16px 内边距 · 圆角 8px 卡片 · 分隔线 #f0f0f0
// ============================================================

import { useMemo, useState } from 'react'
import { FileText, CheckSquare, Rocket, Archive } from 'lucide-react'
import { pxToRem } from '@/lib/utils'

// ============ Tab 定义（顺序与参考截图一致） ============
interface DataTab {
  id: 'shared-files' | 'shared-tasks' | 'published-apps' | 'archived-tasks'
  label: string
  /** 空态文案（与各自 Tab 语义对应） */
  emptyText: string
  icon: typeof FileText
}

const DATA_TABS: DataTab[] = [
  { id: 'shared-files', label: '分享的文件', emptyText: '暂无分享记录', icon: FileText },
  { id: 'shared-tasks', label: '分享的任务', emptyText: '暂无分享记录', icon: CheckSquare },
  { id: 'published-apps', label: '发布的应用', emptyText: '暂无发布记录', icon: Rocket },
  { id: 'archived-tasks', label: '归档的任务', emptyText: '暂无归档记录', icon: Archive }
] as const

export function DataManagementSection() {
  const [activeId, setActiveId] = useState<DataTab['id']>('published-apps')

  const activeTab = useMemo(
    () => DATA_TABS.find((t) => t.id === activeId) ?? DATA_TABS[0]!,
    [activeId]
  )

  return (
    <div className="flex flex-col w-full h-full" style={{ maxWidth: 780 }}>
      {/* ============== Tab 栏（与参考截图的胶囊 Tab 一致） ============== */}
      <div
        className="flex items-center gap-1 shrink-0"
        style={{ marginTop: 32, marginBottom: 16 }}
        role="tablist"
      >
        {DATA_TABS.map((tab) => {
          const active = tab.id === activeId
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveId(tab.id)}
              className="flex items-center gap-1.5 transition-colors rounded-[5px]"
              style={{
                height: 30,
                padding: '0 14px',
                fontSize: pxToRem(13),
                background: active ? '#f0f0f0' : 'transparent',
                color: active ? '#262626' : '#595959',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                border: 'none'
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = '#f5f5f5'
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              <tab.icon size={14} strokeWidth={1.8} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ============== 内容卡片（圆角 8px，1px 描边） ============== */}
      <div
        className="overflow-hidden shrink-0 w-full"
        style={{
          background: '#fff',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          minHeight: 120
        }}
        role="tabpanel"
        aria-label={activeTab.label}
      >
        {/* 空态：垂直居中（与参考截图「暂无发布记录」位置一致） */}
        <div
          className="flex flex-col items-center justify-center w-full select-none"
          style={{ paddingTop: 48, paddingBottom: 48 }}
        >
          <activeTab.icon
            size={28}
            strokeWidth={1.5}
            style={{ color: '#d9d9d9', marginBottom: 10 }}
          />
          <span style={{ fontSize: pxToRem(13), color: '#8c8c8c' }}>{activeTab.emptyText}</span>
        </div>
      </div>
    </div>
  )
}
