// ============================================================
// SecuritySection — 安全中心设置页
// 对齐两张参考截图（上半 + 下半）：
//   · 5 张圆角卡片（8px / 1px #f0f0f0 / overflow hidden）
//     ① 沙箱安全（Switch + 3 跳转行）
//     ② 自动备份（Switch + ⓘ / MB 输入框 + 打开备份目录按钮）
//     ③ 数据安全（已开启 Tag × 2 / 敏感保护·删除保护·批量审批）
//     ④ 内置运行时（总开关 + 3 子运行时 禁用态）
//     ⑤ 审计中心（导出日志/清空记录 + 1 条 Log 示例）
//   · 规格统一：780 max-width / 16px 左右内边距 / 斑马条纹 / hover 高亮
//   · 行类型：SwitchRow · LinkRow · StatusTagRow · InputRow · NumberRow · LogRow
// ============================================================

import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  ChevronRight,
  Info,
  Settings as SettingsGear,
  FolderOpen,
  ShieldCheck,
  Lock,
  HardDriveDownload,
  Eraser,
  Braces,
  Terminal,
  Code,
  GitBranch
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ================================================================
// 主组件
// ================================================================
export function SecuritySection() {
  // ===== 状态：开关 / 输入值（未接入后端，局部 state 占位，后续可迁移到 store） =====
  const [sandboxEnabled, setSandboxEnabled] = useState(true)
  const [autoBackup, setAutoBackup] = useState(true)
  const [backupLimitMB, setBackupLimitMB] = useState(3000)
  const [sensitiveProtect, setSensitiveProtect] = useState(true)
  const [deleteProtect, setDeleteProtect] = useState(false)
  const [batchThreshold, setBatchThreshold] = useState(50)
  const [bundledRuntime, setBundledRuntime] = useState(false)
  const [nodeEnabled, setNodeEnabled] = useState(false)
  const [pythonEnabled, setPythonEnabled] = useState(false)
  const [gitBashEnabled, setGitBashEnabled] = useState(false)

  return (
    <div className="flex flex-col w-full" style={{ maxWidth: 780 }}>
      {/* ============ ① 沙箱安全 ============ */}
      <GroupHeader label="沙箱安全" />
      <SectionCard>
        <SwitchRow
          index={0}
          title="沙箱安全"
          subtitle="AI 运行于隔离沙箱，并配置文件、命令、网络访问策略"
          checked={sandboxEnabled}
          onChange={setSandboxEnabled}
          infoTip="沙箱用于将 AI 动作限制在隔离环境中，防止对宿主系统产生意外影响。"
        />
        <LinkRow
          index={1}
          title="文件安全"
          subtitle="为沙箱拦截后的文件路径配置白名单和黑名单"
          onNavigate={() => { /* 预留：路由跳转 / 展开详情 */ }}
        />
        <LinkRow
          index={2}
          title="命令安全"
          subtitle="为命令前缀配置询问和放行名单"
          onNavigate={() => {}}
        />
        <LinkRow
          index={3}
          title="网络安全"
          subtitle="控制 URL 访问与沙箱网络域名规则"
          onNavigate={() => {}}
          last
        />
      </SectionCard>

      {/* ============ ② 自动备份 ============ */}
      <GroupHeader label="自动备份" />
      <SectionCard>
        <SwitchRow
          index={0}
          title="自动备份"
          subtitle="每轮对话修改文件之前自动备份。"
          checked={autoBackup}
          onChange={setAutoBackup}
          infoTip="备份文件按会话归档，支持回滚到任意轮次的文件状态。"
        />
        <BackupLimitRow
          index={1}
          value={backupLimitMB}
          onChange={(v) => setBackupLimitMB(Math.max(0, v | 0))}
          disabled={!autoBackup}
          last
        />
      </SectionCard>

      {/* ============ ③ 数据安全 ============ */}
      <GroupHeader label="数据安全" />
      <SectionCard>
        <StatusTagRow
          index={0}
          icon={<ShieldCheck size={14} strokeWidth={1.8} />}
          title="安全网关"
          subtitle="工作空间出入流量统一经过安全网关安全处理"
          tag="已开启"
          tagVariant="success"
        />
        <StatusTagRow
          index={1}
          icon={<Lock size={14} strokeWidth={1.8} />}
          title="传输加密"
          subtitle="本地与云端通信使用端到端加密通道"
          tag="已开启"
          tagVariant="success"
        />
        <SwitchRow
          index={2}
          title="敏感保护"
          subtitle="检测并拦截票据、密码等敏感信息的意外泄露"
          checked={sensitiveProtect}
          onChange={setSensitiveProtect}
          rightIcon={<SettingsGearButton onClick={() => {}} />}
        />
        <SwitchRow
          index={3}
          title="删除保护"
          subtitle="开启后优先移到废纸篓/回收站，关闭后按系统删除"
          checked={deleteProtect}
          onChange={setDeleteProtect}
          infoTip="关闭删除保护时删除操作不可恢复，请谨慎操作。"
        />
        <NumberRow
          index={4}
          title="批量删除审批"
          titleHint="需开启删除保护"
          subtitle="一次删除达到该数量时需要审批"
          value={batchThreshold}
          onChange={(v) => setBatchThreshold(Math.max(1, v | 0 || 1))}
          disabled={!deleteProtect}
          last
        />
      </SectionCard>

      {/* ============ ④ 内置运行时 ============ */}
      <GroupHeader label="内置运行时" />
      <SectionCard>
        <SwitchRow
          index={0}
          title="内置运行时"
          subtitle="允许使用随包提供的运行时工具"
          checked={bundledRuntime}
          onChange={setBundledRuntime}
        />
        <SubSwitchRow
          index={1}
          icon={<Braces size={14} strokeWidth={1.8} />}
          title="Node.js"
          subtitle="基于 Chrome V8 引擎的 JavaScript 运行时，用于服务端开发"
          checked={nodeEnabled}
          onChange={setNodeEnabled}
          disabled={!bundledRuntime}
        />
        <SubSwitchRow
          index={2}
          icon={<Code size={14} strokeWidth={1.8} />}
          title="Python"
          subtitle="通用编程语言，适用于脚本编写、自动化和数据处理"
          checked={pythonEnabled}
          onChange={setPythonEnabled}
          disabled={!bundledRuntime}
        />
        <SubSwitchRow
          index={3}
          icon={<GitBranch size={14} strokeWidth={1.8} />}
          title="Git Bash"
          subtitle="在 Windows 上提供 Git 和 Bash Shell 的类 Unix 命令行环境"
          checked={gitBashEnabled}
          onChange={setGitBashEnabled}
          disabled={!bundledRuntime}
          last
        />
      </SectionCard>

      {/* ============ ⑤ 审计中心 ============
          注意：标题在卡片内部（带 导出日志/清空记录 按钮行），
          与其它卡片（标题在外部 GroupHeader）不同，这里不再用 GroupHeader，避免标题重复。 */}
      <SectionCard>
        {/* 头部：标题 + 两个操作按钮 */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '14px 16px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}
        >
          <div className="flex flex-col min-w-0 pr-4">
            <span
              className="shrink-0 truncate"
              style={{ fontSize: 14, color: '#262626', fontWeight: 600 }}
            >
              审计中心
            </span>
            <span className="mt-1 truncate" style={{ fontSize: 12, color: '#8c8c8c' }}>
              拦截/放行记录与日志导出
            </span>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <ButtonGhost
              icon={<HardDriveDownload size={13} />}
              label="导出日志"
              onClick={() => {}}
            />
            <ButtonGhost
              icon={<Eraser size={13} />}
              label="清空记录"
              onClick={() => {}}
              danger
            />
          </div>
        </div>
        {/* 日志条目（示例 1 条） */}
        <LogRow
          index={0}
          tag="[命令安全]"
          content='沙箱内执行命令：ls "C:\\Users\\Administrator\\WorkBuddy\\2026-08...'
          timestamp="2026/9/1 17:31:52"
          last
        />
      </SectionCard>
    </div>
  )
}

// ================================================================
// 共享原子：卡片 / 分组标题
// ================================================================
function SectionCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="shrink-0 w-full overflow-hidden"
      style={{
        background: '#fff',
        border: '1px solid #f0f0f0',
        borderRadius: 8
      }}
    >
      {children}
    </div>
  )
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div
      className="font-semibold select-none shrink-0"
      style={{ fontSize: 14, color: '#262626', marginTop: 32, marginBottom: 16 }}
    >
      {label}
    </div>
  )
}

function RowShell({
  index,
  last,
  children,
  zebra = true,
  hover = true
}: {
  index: number
  last?: boolean
  children: ReactNode
  zebra?: boolean
  hover?: boolean
}) {
  const bg = zebra ? (index % 2 === 1 ? '#fafafa' : '#fff') : '#fff'
  return (
    <div
      className={cn('relative', hover && 'transition-colors hover:bg-[#f5f9ff]')}
      style={{ background: bg }}
    >
      <div
        className="flex items-center justify-between"
        style={{ paddingTop: 15, paddingBottom: 15, paddingLeft: 16, paddingRight: 16 }}
      >
        {children}
      </div>
      {!last && (
        <div
          style={{ height: 1, background: '#f0f0f0', marginLeft: 16, marginRight: 16 }}
          aria-hidden
        />
      )}
    </div>
  )
}

// 通用：左侧（图标可选 + 标题/副文字）容器
function LeftColumn({
  icon,
  title,
  subtitle,
  titleHint
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  titleHint?: string
}) {
  return (
    <div className="flex items-start gap-2.5 min-w-0 pr-6 flex-1">
      {icon && (
        <div
          className="shrink-0 flex items-center justify-center rounded-[5px]"
          style={{
            width: 20,
            height: 20,
            marginTop: 1,
            background: '#f5f5f5',
            color: '#8c8c8c'
          }}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 truncate"
            style={{ fontSize: 14, color: '#262626', fontWeight: 500, lineHeight: '20px' }}
          >
            {title}
          </span>
          {titleHint && (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-px select-none"
              style={{
                fontSize: 11,
                color: '#bfbfbf',
                background: '#fafafa',
                border: '1px dashed #e5e5e5'
              }}
            >
              {titleHint}
            </span>
          )}
        </div>
        {subtitle && (
          <span
            className="mt-1 truncate"
            style={{ fontSize: 12, color: '#8c8c8c', lineHeight: '18px' }}
          >
            {subtitle}
          </span>
        )}
      </div>
    </div>
  )
}

// ================================================================
// 行类型 A：Switch 行（可带 ⓘ 与 右侧附加小图标）
// ================================================================
function SwitchRow({
  index,
  last,
  title,
  subtitle,
  checked,
  onChange,
  disabled,
  infoTip,
  rightIcon
}: {
  index: number
  last?: boolean
  title: string
  subtitle?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  infoTip?: string
  rightIcon?: ReactNode
}) {
  return (
    <RowShell index={index} last={last}>
      <LeftColumn
        icon={infoTip ? <InfoBadge title={infoTip} /> : undefined}
        title={title}
        subtitle={subtitle}
      />
      <div className="shrink-0 flex items-center gap-2">
        {rightIcon}
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
    </RowShell>
  )
}

// ================================================================
// 行类型 B：Link 行（右箭头 ChevronRight）
// ================================================================
function LinkRow({
  index,
  last,
  title,
  subtitle,
  onNavigate
}: {
  index: number
  last?: boolean
  title: string
  subtitle?: string
  onNavigate: () => void
}) {
  return (
    <RowShell index={index} last={last}>
      <LeftColumn title={title} subtitle={subtitle} />
      <button
        onClick={onNavigate}
        className="shrink-0 flex items-center"
        style={{
          width: 26,
          height: 26,
          background: 'transparent',
          border: 'none',
          color: '#bfbfbf',
          cursor: 'pointer',
          padding: 4
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#595959')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#bfbfbf')}
        title="前往配置"
        aria-label="前往配置"
      >
        <ChevronRight size={15} strokeWidth={2} />
      </button>
    </RowShell>
  )
}

// ================================================================
// 行类型 C：状态 Tag 行（右侧 已开启 / 处理中 等）
// ================================================================
function StatusTagRow({
  index,
  last,
  icon,
  title,
  subtitle,
  tag,
  tagVariant = 'success'
}: {
  index: number
  last?: boolean
  icon?: ReactNode
  title: string
  subtitle?: string
  tag: string
  tagVariant?: 'success' | 'warning' | 'default'
}) {
  const styles = {
    success: { bg: '#f0f9eb', color: '#52c41a', border: '1px solid #d9f7be' },
    warning: { bg: '#fffbe6', color: '#faad14', border: '1px solid #ffe58f' },
    default: { bg: '#f5f5f5', color: '#595959', border: '1px solid #e8e8e8' }
  }[tagVariant]

  return (
    <RowShell index={index} last={last} hover={false}>
      <LeftColumn icon={icon} title={title} subtitle={subtitle} />
      <span
        className="shrink-0 rounded-[4px] px-2 py-px select-none"
        style={{
          fontSize: 12,
          ...styles
        }}
      >
        {tag}
      </span>
    </RowShell>
  )
}

// ================================================================
// 行类型 D：备份上限 MB 行 + 打开备份目录 按钮
// ================================================================
function BackupLimitRow({
  index,
  last,
  value,
  onChange,
  disabled
}: {
  index: number
  last?: boolean
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <RowShell index={index} last={last} hover={false}>
      <LeftColumn
        icon={<HardDriveDownload size={14} strokeWidth={1.8} />}
        title="备份总上限"
      />
      <div className="shrink-0 flex items-center gap-3">
        <div className="flex items-center overflow-hidden" style={{ opacity: disabled ? 0.55 : 1 }}>
          <input
            type="number"
            min={0}
            step={100}
            disabled={disabled}
            value={Number.isFinite(value) ? value : 0}
            onChange={(e) => onChange(parseInt(e.target.value || '0', 10))}
            className="outline-none bg-white text-right"
            style={{
              width: 84,
              height: 28,
              padding: '0 10px',
              border: '1px solid #d9d9d9',
              borderRight: 'none',
              borderRadius: '5px 0 0 5px',
              fontSize: 13,
              color: '#262626'
            }}
          />
          <div
            className="flex items-center select-none"
            style={{
              height: 28,
              padding: '0 10px',
              background: '#fafafa',
              border: '1px solid #d9d9d9',
              borderLeft: 'none',
              borderRadius: '0 5px 5px 0',
              fontSize: 12,
              color: '#595959'
            }}
          >
            MB
          </div>
        </div>
        <button
          onClick={() => { /* ipc: 打开备份目录 */ }}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-[5px]"
          style={{
            height: 30,
            padding: '0 12px',
            fontSize: 13,
            background: disabled ? '#fafafa' : '#fff',
            border: '1px solid #d9d9d9',
            color: disabled ? '#bfbfbf' : '#595959',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          <FolderOpen size={13} />
          打开备份目录
        </button>
      </div>
    </RowShell>
  )
}

// ================================================================
// 行类型 E：数字输入行（批量删除审批）
// ================================================================
function NumberRow({
  index,
  last,
  title,
  titleHint,
  subtitle,
  value,
  onChange,
  disabled
}: {
  index: number
  last?: boolean
  title: string
  titleHint?: string
  subtitle?: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <RowShell index={index} last={last} hover={false}>
      <LeftColumn title={title} subtitle={subtitle} titleHint={titleHint} />
      <input
        type="number"
        min={1}
        step={1}
        disabled={disabled}
        value={Number.isFinite(value) ? value : 1}
        onChange={(e) => onChange(parseInt(e.target.value || '1', 10))}
        className="shrink-0 outline-none rounded-[5px] text-right"
        style={{
          width: 70,
          height: 28,
          padding: '0 10px',
          background: disabled ? '#f5f5f5' : '#fff',
          border: disabled ? '1px solid #f0f0f0' : '1px solid #d9d9d9',
          fontSize: 13,
          color: disabled ? '#bfbfbf' : '#262626',
          cursor: disabled ? 'not-allowed' : 'text'
        }}
      />
    </RowShell>
  )
}

// ================================================================
// 行类型 F：SubSwitch（带图标 + 禁用灰态）
// ================================================================
function SubSwitchRow({
  index,
  last,
  icon,
  title,
  subtitle,
  checked,
  onChange,
  disabled
}: {
  index: number
  last?: boolean
  icon: ReactNode
  title: string
  subtitle?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <RowShell index={index} last={last}>
      <LeftColumn
        icon={icon}
        title={title}
        subtitle={subtitle}
      />
      <div className="shrink-0">
        <Switch
          checked={disabled ? false : checked}
          disabled={disabled}
          onCheckedChange={(v) => !disabled && onChange(v)}
        />
      </div>
    </RowShell>
  )
}

// ================================================================
// 行类型 G：日志条目
// ================================================================
function LogRow({
  index,
  last,
  tag,
  content,
  timestamp
}: {
  index: number
  last?: boolean
  tag: string
  content: string
  timestamp: string
}) {
  const bg = index % 2 === 1 ? '#fafafa' : '#fff'
  return (
    <div className="relative" style={{ background: bg }}>
      <div
        className="flex items-start gap-3"
        style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 16 }}
      >
        <Terminal
          size={14}
          strokeWidth={1.8}
          className="shrink-0 mt-0.5"
          style={{ color: '#8c8c8c' }}
        />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-start gap-2 min-w-0">
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-px select-none"
              style={{
                fontSize: 11,
                background: '#e6f4ff',
                color: '#1677ff',
                border: '1px solid #91caff'
              }}
            >
              {tag}
            </span>
            <span
              className="truncate min-w-0"
              style={{ fontSize: 13, color: '#262626', lineHeight: '18px' }}
            >
              {content}
            </span>
          </div>
          <span className="mt-1 shrink-0" style={{ fontSize: 11, color: '#bfbfbf' }}>
            {timestamp}
          </span>
        </div>
      </div>
      {!last && (
        <div
          style={{ height: 1, background: '#f0f0f0', marginLeft: 16, marginRight: 16 }}
          aria-hidden
        />
      )}
    </div>
  )
}

// ================================================================
// 基础控件：Switch / InfoBadge / SettingsGearButton / ButtonGhost
// ================================================================
function Switch({
  checked,
  disabled,
  onCheckedChange
}: {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200',
        disabled && 'cursor-not-allowed opacity-60',
        !disabled && 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1677ff]/40'
      )}
      style={{
        width: 30,
        height: 17,
        background: checked ? '#52c41a' : '#d9d9d9'
      }}
    >
      <span
        className="pointer-events-none inline-block transform rounded-full bg-white transition-transform duration-200"
        style={{
          width: 13,
          height: 13,
          marginLeft: 2,
          transform: `translateX(${checked ? 13 : 0}px)`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
        }}
      />
    </button>
  )
}

function InfoBadge({ title }: { title: string }) {
  return (
    <span title={title} className="shrink-0" style={{ cursor: 'help', color: '#1677ff' }}>
      <Info size={14} strokeWidth={1.8} />
    </span>
  )
}

function SettingsGearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="配置规则"
      title="配置敏感保护规则"
      onClick={onClick}
      className="shrink-0 flex items-center justify-center rounded-full border border-[#d9d9d9] bg-white transition-colors hover:bg-[#f5f5f5] hover:border-[#bfbfbf]"
      style={{ width: 24, height: 24 }}
    >
      <SettingsGear size={13} stroke="#8c8c8c" strokeWidth={1.8} />
    </button>
  )
}

function ButtonGhost({
  icon,
  label,
  onClick,
  danger = false
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-[5px] transition-colors"
      style={{
        height: 28,
        padding: '0 10px',
        fontSize: 12,
        background: '#fff',
        border: '1px solid #d9d9d9',
        color: danger ? '#ff4d4f' : '#595959',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? '#fff1f0' : '#f5f5f5'
        e.currentTarget.style.borderColor = danger ? '#ffccc7' : '#bfbfbf'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#fff'
        e.currentTarget.style.borderColor = '#d9d9d9'
      }}
    >
      {icon}
      {label}
    </button>
  )
}
