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
import { cn, pxToRem } from '@/lib/utils'

// T7 修复（修复任务清单 T7 / 报告 §2.7）：
// 本页 10 组开关/输入仅为组件 state，无持久化、无任何主进程联动，
// 与真实安全实现（IPC trusted sender 校验 / 文件路径白名单 / 产物 iframe sandbox /
// CSP / Markdown sanitize）零耦合。真实开关逐项落地前整页锁定为「规划中」：
//   - 顶部公告明示「当前设置不会生效」；
//   - 内容区禁用全部交互（pointer-events-none）并整体灰显；
//   - 开关强制渲染为关闭态，避免「沙箱安全默认开」构成安全错觉；
//   - 装饰性「已开启」标签改为「规划中」。
const SECURITY_CENTER_PLANNING = true

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
      {/* T7：规划中公告（真实安全开关逐项接线后移除本公告与下方锁定态） */}
      <div
        className="flex items-start gap-2 rounded-lg border px-3 py-2.5 leading-[1.55] mb-2"
        style={{
          background: 'var(--set-warn-bg)',
          borderColor: 'var(--set-warn-border)',
          color: 'var(--set-warn-text)',
          fontSize: pxToRem(12)
        }}
      >
        <Info className="mt-[1px] shrink-0 size-4" />
        <span>
          安全中心正在规划中：以下开关与配置当前仅作展示，不会保存、也不会改变应用的实际安全行为。
          当前已生效的安全能力包括进程间调用校验、文件路径白名单、产物沙箱预览与内容安全过滤。
        </span>
      </div>

      <div
        // 锁定层：禁用整页交互 + 整体灰显（公告本身在锁定层之外，保持可读）
        className="pointer-events-none select-none"
        style={{ opacity: 0.55 }}
        aria-disabled={true}
      >
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
          tag="规划中"
          tagVariant="default"
        />
        <StatusTagRow
          index={1}
          icon={<Lock size={14} strokeWidth={1.8} />}
          title="传输加密"
          subtitle="本地与云端通信使用端到端加密通道"
          tag="规划中"
          tagVariant="default"
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
          style={{ padding: '14px 16px', background: 'var(--set-card)', borderBottom: '1px solid var(--set-border)' }}
        >
          <div className="flex flex-col min-w-0 pr-4">
            <span
              className="shrink-0 truncate"
              style={{ fontSize: pxToRem(14), color: 'var(--set-text)', fontWeight: 600 }}
            >
              审计中心
            </span>
            <span className="mt-1 truncate" style={{ fontSize: pxToRem(12), color: 'var(--set-desc)' }}>
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
        {/* 日志条目（示例 1 条；T7：标注「演示数据」，审计中心尚未接入真实记录） */}
        <LogRow
          index={0}
          tag="[演示数据]"
          content='沙箱内执行命令：ls "C:\\Users\\Administrator\\WorkBuddy\\2026-08...'
          timestamp="2026/9/1 17:31:52"
          last
        />
      </SectionCard>
      </div>
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
        background: 'var(--set-card)',
        border: '1px solid var(--set-border)',
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
      style={{ fontSize: pxToRem(14), color: 'var(--set-text)', marginTop: 32, marginBottom: 16 }}
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
  const bg = zebra ? (index % 2 === 1 ? 'var(--set-surface-alt)' : 'var(--set-card)') : 'var(--set-card)'
  return (
    <div
      className={cn('relative', hover && 'transition-colors hover:bg-[var(--set-row-hover)]')}
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
          style={{ height: 1, background: 'var(--set-border)', marginLeft: 16, marginRight: 16 }}
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
            background: 'var(--set-hover-bg)',
            color: 'var(--set-desc)'
          }}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 truncate"
            style={{ fontSize: pxToRem(14), color: 'var(--set-text)', fontWeight: 500, lineHeight: '20px' }}
          >
            {title}
          </span>
          {titleHint && (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-px select-none"
              style={{
                fontSize: pxToRem(11),
                color: 'var(--set-desc)',
                background: 'var(--set-surface-alt)',
                border: '1px dashed var(--set-divider)'
              }}
            >
              {titleHint}
            </span>
          )}
        </div>
        {subtitle && (
          <span
            className="mt-1 truncate"
            style={{ fontSize: pxToRem(12), color: 'var(--set-desc)', lineHeight: '18px' }}
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
          color: 'var(--set-faint)',
          cursor: 'pointer',
          padding: 4
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--set-text-secondary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--set-faint)')}
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
    success: { bg: 'var(--set-success-bg)', color: 'var(--set-success)', border: '1px solid var(--set-success-border)' },
    warning: { bg: 'var(--set-warning-bg)', color: 'var(--set-warning)', border: '1px solid var(--set-warning-border)' },
    default: { bg: 'var(--set-hover-bg)', color: 'var(--set-text-secondary)', border: '1px solid var(--set-disabled)' }
  }[tagVariant]

  return (
    <RowShell index={index} last={last} hover={false}>
      <LeftColumn icon={icon} title={title} subtitle={subtitle} />
      <span
        className="shrink-0 rounded-[4px] px-2 py-px select-none"
        style={{
          fontSize: pxToRem(12),
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
            className="outline-none bg-[var(--set-card)] text-right"
            style={{
              width: 84,
              height: 28,
              padding: '0 10px',
              border: '1px solid var(--set-control-border)',
              borderRight: 'none',
              borderRadius: '5px 0 0 5px',
              fontSize: pxToRem(13),
              color: 'var(--set-text)'
            }}
          />
          <div
            className="flex items-center select-none"
            style={{
              height: 28,
              padding: '0 10px',
              background: 'var(--set-surface-alt)',
              border: '1px solid var(--set-control-border)',
              borderLeft: 'none',
              borderRadius: '0 5px 5px 0',
              fontSize: pxToRem(12),
              color: 'var(--set-text-secondary)'
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
            fontSize: pxToRem(13),
            background: disabled ? 'var(--set-surface-alt)' : 'var(--set-card)',
            border: '1px solid var(--set-control-border)',
            color: disabled ? 'var(--set-faint)' : 'var(--set-text-secondary)',
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
          background: disabled ? 'var(--set-hover-bg)' : 'var(--set-card)',
          border: disabled ? '1px solid var(--set-border)' : '1px solid var(--set-control-border)',
          fontSize: pxToRem(13),
          color: disabled ? 'var(--set-faint)' : 'var(--set-text)',
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
  const bg = index % 2 === 1 ? 'var(--set-surface-alt)' : 'var(--set-card)'
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
          style={{ color: 'var(--set-desc)' }}
        />
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-start gap-2 min-w-0">
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-px select-none"
              style={{
                fontSize: pxToRem(11),
                background: 'var(--set-accent-bg)',
                color: 'var(--set-accent)',
                border: '1px solid var(--set-accent-border)'
              }}
            >
              {tag}
            </span>
            <span
              className="truncate min-w-0"
              style={{ fontSize: pxToRem(13), color: 'var(--set-text)', lineHeight: '18px' }}
            >
              {content}
            </span>
          </div>
          <span className="mt-1 shrink-0" style={{ fontSize: pxToRem(11), color: 'var(--set-desc)' }}>
            {timestamp}
          </span>
        </div>
      </div>
      {!last && (
        <div
          style={{ height: 1, background: 'var(--set-border)', marginLeft: 16, marginRight: 16 }}
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
  // T7：规划期开关强制渲染为关闭+禁用态，避免「沙箱安全默认开」的安全错觉
  const locked = SECURITY_CENTER_PLANNING
  const effectiveDisabled = locked || disabled
  const effectiveChecked = locked ? false : checked
  return (
    <button
      type="button"
      role="switch"
      aria-checked={effectiveChecked}
      aria-label={locked ? '该能力规划中，暂不可用' : undefined}
      disabled={effectiveDisabled}
      onClick={() => !effectiveDisabled && onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200',
        effectiveDisabled && 'cursor-not-allowed opacity-60',
        !effectiveDisabled && 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--set-accent)]'
      )}
      style={{
        width: 30,
        height: 17,
        background: effectiveChecked ? 'var(--set-switch-on)' : 'var(--set-switch-off)'
      }}
    >
      <span
        className="pointer-events-none inline-block transform rounded-full bg-[var(--set-switch-knob)] transition-transform duration-200"
        style={{
          width: 13,
          height: 13,
          marginLeft: 2,
          transform: `translateX(${effectiveChecked ? 13 : 0}px)`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
        }}
      />
    </button>
  )
}

function InfoBadge({ title }: { title: string }) {
  return (
    <span title={title} className="shrink-0" style={{ cursor: 'help', color: 'var(--set-accent)' }}>
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
      className="shrink-0 flex items-center justify-center rounded-full border border-[var(--set-control-border)] bg-[var(--set-card)] transition-colors hover:bg-[var(--set-hover-bg)] hover:border-[var(--set-faint)]"
      style={{ width: 24, height: 24 }}
    >
      <SettingsGear size={13} stroke="var(--set-desc)" strokeWidth={1.8} />
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
        fontSize: pxToRem(12),
        background: 'var(--set-card)',
        border: '1px solid var(--set-control-border)',
        color: danger ? 'var(--set-danger)' : 'var(--set-text-secondary)',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--set-danger-bg)' : 'var(--set-hover-bg)'
        e.currentTarget.style.borderColor = danger ? 'var(--set-danger-border)' : 'var(--set-faint)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--set-card)'
        e.currentTarget.style.borderColor = 'var(--set-control-border)'
      }}
    >
      {icon}
      {label}
    </button>
  )
}
