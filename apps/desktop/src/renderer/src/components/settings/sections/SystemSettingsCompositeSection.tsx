// ============================================================
// SystemSettingsCompositeSection — 系统设置（复合页）
//   侧边栏 11 项层级下：点击「系统设置」单条 → 右栏渲染本复合页，
//   内嵌三个独立 Section 为三张卡片，对应：
//     ① 本地运行时 → LocalRuntimeSection（showHeader=false, compact）
//     ② 外网 API   → ApiConnectionSection（同上）
//     ③ 认证       → AuthSection（同上）
//   样式规格与 GeneralSection 一致：
//     GroupHeader 13px 粗 #262626 · mt-6 mb-3（首组 mt-0）
//     SectionCard #fafafa · 8px 圆角 · 1px #f0f0f0 描边 · p-4 内边距
// ============================================================

import { HardDrive, Globe, Key } from 'lucide-react'
import { LocalRuntimeSection } from './LocalRuntimeSection'
import { ApiConnectionSection } from './ApiConnectionSection'
import { AuthSection } from './AuthSection'
import type { ReactNode } from 'react'

export function SystemSettingsCompositeSection() {
  return (
    <div className="flex flex-col w-full h-full pr-1">
      {/* ① 本地运行时 */}
      <GroupHeader label="本地运行时" icon={<HardDrive size={14} stroke="#595959" strokeWidth={2} />} />
      <SectionCard>
        <LocalRuntimeSection showHeader={false} compact />
      </SectionCard>

      {/* ② 外网 API */}
      <GroupHeader label="外网 API" icon={<Globe size={14} stroke="#595959" strokeWidth={2} />} />
      <SectionCard>
        <ApiConnectionSection showHeader={false} compact />
      </SectionCard>

      {/* ③ 认证 */}
      <GroupHeader label="认证" icon={<Key size={14} stroke="#595959" strokeWidth={2} />} />
      <SectionCard>
        <AuthSection showHeader={false} compact />
      </SectionCard>
    </div>
  )
}

// ========== 视觉容器（与 GeneralSection 保持一致的设计语言） ==========

function GroupHeader({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 font-semibold select-none shrink-0"
      style={{ fontSize: 13, color: '#262626', marginTop: 24, marginBottom: 12 }}
    >
      {icon}
      <span>{label}</span>
    </div>
  )
}

function SectionCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="shrink-0 w-full overflow-hidden"
      style={{
        background: '#fafafa',
        borderRadius: 8,
        border: '1px solid #f0f0f0',
        padding: 16
      }}
    >
      {children}
    </div>
  )
}
