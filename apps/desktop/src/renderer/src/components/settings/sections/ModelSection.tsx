// ============================================================
// ModelSection — 设置弹框「模型」分类区块
//   还原用户截图的 模型管理 界面：
//     · 标题 + 说明文案
//     · 「+ 添加模型」按钮
//     · 蓝色提示条（本地环境使用限制）
//     · 三列表格：模型（带图标）/ 服务商 / 操作（编辑/删除/开关）
// ============================================================

import { useMemo, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Info,
  Cpu,
  BrainCircuit,
  Sparkles,
  Zap,
  Network
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useAppStore,
  type ModelConfigItem
} from '@/stores/useAppStore'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader
} from '@/components/ui/dialog'
import { openConfirmDialogAtom } from '@/stores/atoms'
import { useSetAtom } from 'jotai'

// ---- 图标映射（按 iconKey） ----
const MODEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  'openai-compat': Network,
  deepseek: Sparkles,
  glm: BrainCircuit,
  kimi: Zap,
  minimax: Cpu
}

const MODEL_ICON_COLOR: Record<string, string> = {
  'openai-compat': 'text-slate-500',
  deepseek: 'text-purple-500',
  glm: 'text-emerald-500',
  kimi: 'text-indigo-500',
  minimax: 'text-amber-500'
}

type ModelFormData = Omit<ModelConfigItem, 'enabled'> & { enabled: boolean }

const DEFAULT_PROVIDER_OPTIONS = [
  'DeepSeek',
  'Bigmodel',
  'MiniMax-cn',
  'Moonshot AI',
  '自定义(OpenAI Compatible)'
] as const

const EMPTY_FORM: ModelFormData = {
  id: '',
  name: '',
  provider: 'DeepSeek',
  iconKey: 'deepseek',
  enabled: true,
  value: '',
  apiBase: '',
  apiKey: ''
}

/** 根据 provider 推断默认 iconKey */
function providerToIcon(provider: string): ModelConfigItem['iconKey'] {
  const p = provider.toLowerCase()
  if (p.includes('deepseek')) return 'deepseek'
  if (p.includes('glm') || p.includes('bigmodel') || p.includes('zhipu')) return 'glm'
  if (p.includes('kimi') || p.includes('moonshot')) return 'kimi'
  if (p.includes('minimax')) return 'minimax'
  return 'openai-compat'
}

export function ModelSection() {
  const modelConfigs = useAppStore((s) => s.modelConfigs)
  const upsertModelConfig = useAppStore((s) => s.upsertModelConfig)
  const removeModelConfig = useAppStore((s) => s.removeModelConfig)
  const toggleModelEnabled = useAppStore((s) => s.toggleModelEnabled)
  const openConfirmDialog = useSetAtom(openConfirmDialogAtom)

  // 编辑/新增弹窗
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ModelFormData>(EMPTY_FORM)

  const isEditing = editingId !== null
  const dialogTitle = isEditing ? '编辑模型' : '添加模型'

  const rows = useMemo(() => modelConfigs, [modelConfigs])

  const openAddDialog = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, id: `custom-${Date.now()}` })
    setDialogOpen(true)
  }

  const openEditDialog = (item: ModelConfigItem) => {
    setEditingId(item.id)
    setForm({
      id: item.id,
      name: item.name,
      provider: item.provider,
      iconKey: item.iconKey,
      enabled: item.enabled,
      value: item.value ?? '',
      apiBase: item.apiBase ?? '',
      apiKey: item.apiKey ?? ''
    })
    setDialogOpen(true)
  }

  const handleSave = () => {
    const name = form.name.trim()
    if (!name) return
    const next: ModelConfigItem = {
      id: form.id,
      name,
      provider: form.provider,
      iconKey: providerToIcon(form.provider),
      enabled: form.enabled,
      value: (form.value ?? '').trim() || name,
      apiBase: (form.apiBase ?? '').trim() || undefined,
      apiKey: (form.apiKey ?? '').trim() || undefined
    }
    upsertModelConfig(next)
    setDialogOpen(false)
  }

  const handleDelete = (item: ModelConfigItem) => {
    openConfirmDialog({
      id: `del-model-${item.id}`,
      title: '删除模型',
      description: `确定要删除模型「${item.name}」吗？删除后将无法使用该模型发起对话。`,
      confirmText: '删除',
      cancelText: '取消',
      confirmVariant: 'destructive',
      icon: 'danger',
      onConfirm: () => removeModelConfig(item.id)
    })
  }

  return (
    <div className="space-y-5">
      {/* 标题区 */}
      <div>
        <h2 className="text-[22px] font-semibold leading-[1.2] tracking-[0.01em]" style={{ color: '#1a1a1a' }}>
          模型管理
        </h2>
        <p className="mt-1 text-[13px] leading-[1.5] text-[#595959]">
          配置 API key 添加更多可用模型，预置模型默认使用稳定版本。
        </p>
      </div>

      {/* 添加按钮 */}
      <div>
        <Button variant="outline" size="sm" onClick={openAddDialog} className="gap-1.5">
          <Plus className="size-4" />
          添加模型
        </Button>
      </div>

      {/* 提示条 */}
      <div
        className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-[1.55]"
        style={{
          background: 'rgba(59,130,246,0.08)',
          borderColor: 'rgba(59,130,246,0.25)',
          color: '#1d4ed8'
        }}
      >
        <Info className="mt-[1px] shrink-0 size-4" />
        <span>添加的模型仅支持在 TRAE 本地环境中使用，暂不支持在云端环境中使用。</span>
      </div>

      {/* 表格 */}
      <div
        className="overflow-hidden rounded-lg border"
        style={{ borderColor: '#e5e5e5', background: '#fff' }}
      >
        {/* 表头 */}
        <div
          className="grid grid-cols-[1fr_240px_120px] items-center px-4 py-2 text-[12px] font-medium"
          style={{ background: '#f5f5f5', color: '#595959' }}
        >
          <div>模型</div>
          <div>服务商</div>
          <div className="text-right">操作</div>
        </div>

        {/* 行 */}
        <div className="divide-y" style={{ borderColor: '#f0f0f0' }}>
          {rows.length === 0 && (
            <div className="px-4 py-10 text-center text-[12px] text-[#8c8c8c]">
              暂无模型，点击「添加模型」开始配置。
            </div>
          )}
          {rows.map((item) => {
            const IconComp = MODEL_ICON[item.iconKey] ?? Cpu
            const iconColor = MODEL_ICON_COLOR[item.iconKey] ?? 'text-slate-500'
            return (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_240px_120px] items-center px-4 py-[10px] transition-colors hover:bg-[#fafafa]"
              >
                {/* 模型列：图标 + 名称 */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="flex size-6 shrink-0 items-center justify-center rounded-[6px]"
                    style={{ background: '#f5f5f5' }}
                  >
                    <IconComp className={cn('size-3.5', iconColor)} />
                  </div>
                  <span
                    className="truncate text-[13px] font-medium"
                    style={{ color: '#262626' }}
                  >
                    {item.name}
                  </span>
                </div>

                {/* 服务商 */}
                <div className="truncate text-[12px] text-[#595959]">{item.provider}</div>

                {/* 操作列：编辑 / 删除 / 开关 */}
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[#8c8c8c] transition-colors hover:bg-black/5 hover:text-[#595959]"
                    title="编辑"
                    onClick={() => openEditDialog(item)}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[#8c8c8c] transition-colors hover:bg-red-50 hover:text-red-500"
                    title="删除"
                    onClick={() => handleDelete(item)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  {/* 启用开关：自定义样式对齐截图的绿色 pill */}
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={() => toggleModelEnabled(item.id)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 新增 / 编辑 对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="!max-w-[480px] !p-0 !gap-0 overflow-hidden" style={{ borderRadius: 12 }}>
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-[17px] font-semibold" style={{ color: '#1a1a1a' }}>
              {dialogTitle}
            </DialogTitle>
            <DialogDescription className="sr-only">{dialogTitle}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[80px_1fr] items-start gap-y-4 gap-x-4 px-6 py-4">
            <Label>模型名称</Label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：DeepSeek-V4-Flash"
              className="input-field"
            />

            <Label>服务商</Label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="input-field"
            >
              {DEFAULT_PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <Label>模型 ID</Label>
            <input
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="发送到后端的 model 字段，留空则使用模型名称"
              className="input-field"
            />

            <Label>API Base</Label>
            <input
              value={form.apiBase ?? ''}
              onChange={(e) => setForm({ ...form, apiBase: e.target.value })}
              placeholder="自定义服务时填写，例如 https://api.deepseek.com/v1"
              className="input-field"
            />

            <Label>API Key</Label>
            <input
              type="password"
              value={form.apiKey ?? ''}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="可选，未填则使用后端默认配置"
              className="input-field"
            />

            <Label>启用</Label>
            <div className="flex items-center h-9">
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm({ ...form, enabled: v })}
              />
              <span className="ml-2.5 text-[12px] text-[#595959]">
                启用后将出现在输入框模型列表
              </span>
            </div>
          </div>

          <DialogFooter className="px-6 pb-6 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!form.name.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 内联样式：表单字段 + 自定义开关 */}
      <style>{`
        .input-field {
          height: 32px;
          width: 100%;
          border-radius: 6px;
          border: 1px solid #d9d9d9;
          background: #fff;
          padding: 0 10px;
          font-size: 13px;
          color: #262626;
          outline: none;
          transition: border-color .15s;
        }
        .input-field:focus {
          border-color: #1677ff;
          box-shadow: 0 0 0 2px rgba(22,119,255,0.12);
        }
        select.input-field {
          padding-right: 28px;
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238c8c8c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
          background-repeat: no-repeat;
          background-position: right 10px center;
          background-size: 10px;
        }
      `}</style>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center h-8 text-[13px] font-medium"
      style={{ color: '#595959' }}
    >
      {children}
    </div>
  )
}

/** 自定义 Switch：对齐截图的绿色 Pill 样式（无第三方依赖）。 */
function Switch({
  checked,
  onCheckedChange
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  const OFF = 'bg-[#d9d9d9]'
  const ON = 'bg-[#52c41a]'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-[30px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1677ff]/40',
        checked ? ON : OFF
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-transform duration-200',
          checked ? 'translate-x-[13px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}
