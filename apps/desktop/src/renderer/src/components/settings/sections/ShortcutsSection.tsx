// ============================================================
// ShortcutsSection — 快捷键设置页（M4）
// 结构对齐参考截图（命令 | 按键绑定 | 操作 三列）：
//   · 搜索框（按 label/keywords 实时过滤）
//   · 三列表头 + 列表行 + 全宽 1px 分隔线（与 GeneralSection 视觉一致）
//   · 点击绑定胶囊 → 录制弹窗（e.code 捕获，Esc 取消）
//   · 冲突检测（findConflicts）+ 危险键位提示（isDangerousBinding）
//   · 垃圾桶 = 清空绑定（allowEmpty=false 的命令禁用）
//   · 「全部恢复默认」→ HOTKEYS_RESET
//   · 纯浏览器环境降级提示（mock set/reset 返回 ok:false）
// 持久化：electron-store 为主进程唯一真源；
//   本地 state 为编辑态草稿，确认后全量提交 HOTKEYS_SET → ACK 回写 appStore 缓存
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Trash2, AlertTriangle, RotateCcw, X } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import {
  HOTKEY_DEFINITIONS,
  findConflicts,
  isDangerousBinding,
  resolveBinding
} from '../../../../../shared/hotkey-registry'
import type { HotkeyId, HotkeyOverrides, HotkeyBinding } from '../../../../../shared/hotkey-protocol'
import { eventToAccelerator, formatBindingForDisplay } from '@/lib/match-accelerator'

/** 冲突信息：绑定串 → 占用该绑定的其它命令 label */
interface ConflictInfo {
  binding: string
  others: string[]
}

export function ShortcutsSection() {
  const syncHotkeys = useAppStore((s) => s.syncHotkeys)
  const cachedOverrides = useAppStore((s) => s.hotkeys)

  // 编辑态草稿（本地全量覆盖表，确认后提交主进程）
  const [draft, setDraft] = useState<HotkeyOverrides>(cachedOverrides)
  const [query, setQuery] = useState('')
  // 正在录制的命令（null = 关闭弹窗）
  const [recordingId, setRecordingId] = useState<HotkeyId | null>(null)
  const [conflictInfo, setConflictInfo] = useState<ConflictInfo | null>(null)
  const [dangerBinding, setDangerBinding] = useState<string | null>(null)
  // 纯浏览器环境降级（mock set/reset 失败一次后置位）
  const [degraded, setDegraded] = useState(false)
  // 全局快捷键注册冲突（主进程返回）
  const [globalConflicts, setGlobalConflicts] = useState<string[]>([])
  const [isApplying, setIsApplying] = useState(false)

  // appStore 缓存被外部（HOTKEYS_RESET / 其它窗口）更新时同步草稿
  useEffect(() => {
    setDraft(cachedOverrides)
  }, [cachedOverrides])

  /** 全量提交草稿到主进程（SOT），ACK 后回写缓存 */
  const commit = useCallback(
    async (next: HotkeyOverrides) => {
      setIsApplying(true)
      try {
        const result = await window.api.hotkeys.set(next)
        if (result.ok) {
          setDraft(result.overrides)
          syncHotkeys(result.overrides)
          setGlobalConflicts(result.conflicts ?? [])
          setDegraded(false)
        } else {
          // 纯浏览器环境：mock 返回降级错误
          setDegraded(true)
        }
      } catch {
        setDegraded(true)
      } finally {
        setIsApplying(false)
      }
    },
    [syncHotkeys]
  )

  /** 录制确认：冲突/危险检查 → 更新草稿 → 提交 */
  const applyRecording = useCallback(
    (id: HotkeyId, binding: HotkeyBinding) => {
      const next = { ...draft }
      // 与默认一致则从覆盖表移除（保持表最小）
      const def = HOTKEY_DEFINITIONS.find((d) => d.id === id)
      if (def && binding === def.defaultBinding) {
        delete next[id]
      } else {
        next[id] = binding
      }

      // 冲突检测：同一绑定被其它命令占用 → 提示（允许用户坚持应用，后者覆盖前者语义由用户自行取舍）
      if (binding) {
        const hits = findConflicts(id, binding, next)
        if (hits.length > 0) {
          setConflictInfo({
            binding,
            others: hits.map((h) => HOTKEY_DEFINITIONS.find((d) => d.id === h)?.label ?? h)
          })
        }
        if (isDangerousBinding(binding)) {
          setDangerBinding(binding)
        }
      }

      setDraft(next)
      void commit(next)
    },
    [draft, commit]
  )

  /** 清空绑定（禁用该命令） */
  const clearBinding = useCallback(
    (id: HotkeyId) => {
      const next = { ...draft, [id]: null }
      setDraft(next)
      void commit(next)
    },
    [draft, commit]
  )

  /** 恢复单条默认 */
  const resetOne = useCallback(
    (id: HotkeyId) => {
      const next = { ...draft }
      delete next[id]
      setDraft(next)
      void commit(next)
    },
    [draft, commit]
  )

  /** 全部恢复默认 */
  const resetAll = useCallback(async () => {
    setIsApplying(true)
    try {
      const result = await window.api.hotkeys.reset()
      if (result.ok) {
        setDraft(result.overrides)
        syncHotkeys(result.overrides)
        setGlobalConflicts(result.conflicts ?? [])
        setConflictInfo(null)
        setDangerBinding(null)
      } else {
        setDegraded(true)
      }
    } catch {
      setDegraded(true)
    } finally {
      setIsApplying(false)
    }
  }, [syncHotkeys])

  // 搜索过滤
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return HOTKEY_DEFINITIONS
    return HOTKEY_DEFINITIONS.filter(
      (d) => d.label.toLowerCase().includes(q) || (d.keywords ?? []).some((k) => k.toLowerCase().includes(q)) || d.id.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <div className="flex flex-col w-full h-full" style={{ maxWidth: 780 }}>
      {/* 降级提示：纯浏览器环境无主进程 globalShortcut / 持久化 */}
      {degraded && (
        <div
          className="flex items-start gap-2 rounded-[5px] px-4 py-3 mb-3"
          style={{ background: '#fffbe6', border: '1px solid #ffe58f' }}
        >
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: '#faad14' }} />
          <div className="text-[13px]" style={{ color: '#8c6d1f' }}>
            当前为纯浏览器环境：快捷键修改不会持久化，全局快捷键（如唤起主窗口）不可用。
            渲染层快捷键仍按默认绑定生效。
          </div>
        </div>
      )}

      {/* 全局快捷键注册失败（系统占用）提示 */}
      {globalConflicts.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-[5px] px-4 py-3 mb-3"
          style={{ background: '#fff2f0', border: '1px solid #ffccc7' }}
        >
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: '#ff4d4f' }} />
          <div className="text-[13px]" style={{ color: '#8c3b38' }}>
            {globalConflicts.join('；')}
          </div>
        </div>
      )}

      {/* 工具行：搜索 + 全部恢复默认 */}
      <div className="flex items-center justify-between" style={{ marginTop: 32, marginBottom: 16 }}>
        <div
          className="flex items-center gap-2 rounded-[5px] px-3"
          style={{ width: 240, height: 30, background: '#fff', border: '1px solid #d9d9d9' }}
        >
          <Search size={14} style={{ color: '#bfbfbf' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索快捷键"
            className="flex-1 outline-none bg-transparent"
            style={{ fontSize: 13, color: '#262626' }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="flex items-center"
              style={{ color: '#bfbfbf', cursor: 'pointer' }}
              aria-label="清空搜索"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={() => void resetAll()}
          disabled={isApplying}
          className="flex items-center gap-1.5 rounded-[5px] px-3"
          style={{
            height: 30,
            fontSize: 13,
            background: '#fff',
            border: '1px solid #d9d9d9',
            color: '#595959',
            cursor: isApplying ? 'not-allowed' : 'pointer',
            opacity: isApplying ? 0.6 : 1
          }}
        >
          <RotateCcw size={13} />
          全部恢复默认
        </button>
      </div>

      {/* 快捷键列表：圆角卡片容器 */}
      <div
        className="overflow-hidden"
        style={{
          background: '#fff',
          border: '1px solid #f0f0f0',
          borderRadius: 8
        }}
      >
        {/* 三列表头（卡在卡片内，浅灰背景区分） */}
        <div
          className="flex items-center"
          style={{
            padding: '12px 16px',
            background: '#fafafa',
            borderBottom: '1px solid #f0f0f0'
          }}
        >
          <span className="text-[12px]" style={{ color: '#8c8c8c', width: 260 }}>命令</span>
          <span className="text-[12px]" style={{ color: '#8c8c8c', flex: 1 }}>按键绑定</span>
          <span className="text-[12px]" style={{ color: '#8c8c8c', width: 60, textAlign: 'right' }}>操作</span>
        </div>

        {/* 列表行 */}
        {rows.length > 0 ? (
          rows.map((def, idx) => {
            const binding = resolveBinding(def.id, draft)
            const isDefault = draft[def.id] === undefined
            const isRecording = recordingId === def.id
            const isLast = idx === rows.length - 1
            // 斑马条纹：偶数行微灰背景，与截图一致
            const zebraBg = idx % 2 === 1 ? '#fafafa' : '#fff'
            return (
              <div
                key={def.id}
                className="flex items-center transition-colors hover:bg-[#f5f9ff]"
                style={{
                  padding: '13px 16px',
                  background: zebraBg,
                  borderBottom: isLast ? 'none' : '1px solid #f0f0f0'
                }}
              >
                {/* 命令列 */}
                <div className="flex flex-col min-w-0" style={{ width: 260 }}>
                  <span className="truncate" style={{ fontSize: 14, color: '#262626', fontWeight: 500 }}>
                    {def.label}
                  </span>
                  {def.scope === 'global' && (
                    <span style={{ fontSize: 11, color: '#bfbfbf', marginTop: 2 }}>全局（窗口外生效）</span>
                  )}
                </div>

                {/* 绑定列：胶囊 Tag，点击录制 */}
                <div className="flex items-center gap-2" style={{ flex: 1 }}>
                  <button
                    onClick={() => !def.readOnly && setRecordingId(def.id)}
                    disabled={def.readOnly}
                    className="flex items-center rounded-[5px]"
                    style={{
                      height: 26,
                      padding: '0 10px',
                      fontSize: 12,
                      background: isRecording ? '#e6f4ff' : binding ? '#f5f5f5' : 'transparent',
                      border: isRecording
                        ? '1px solid #1677ff'
                        : binding
                          ? '1px solid #e5e5e5'
                          : '1px dashed #d9d9d9',
                      color: binding ? '#595959' : '#bfbfbf',
                      cursor: def.readOnly ? 'not-allowed' : 'pointer',
                      opacity: def.readOnly ? 0.7 : 1
                    }}
                    title={def.readOnly ? '系统标准编辑键，不可修改' : '点击修改快捷键'}
                  >
                    {isRecording ? '按下新的组合键…' : formatBindingForDisplay(binding)}
                  </button>
                  {/* 修改过的绑定给"已自定义"标记 + 单条恢复默认 */}
                  {!isDefault && !def.readOnly && (
                    <button
                      onClick={() => resetOne(def.id)}
                      className="flex items-center gap-1"
                      style={{ fontSize: 12, color: '#8c8c8c', cursor: 'pointer', background: 'transparent', border: 'none' }}
                      title="恢复此命令默认绑定"
                    >
                      <RotateCcw size={12} />
                      默认
                    </button>
                  )}
                </div>

                {/* 操作列：清空绑定（垃圾桶） */}
                <div className="flex items-center justify-end" style={{ width: 60 }}>
                  <button
                    onClick={() => clearBinding(def.id)}
                    disabled={!def.allowEmpty || def.readOnly}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: def.allowEmpty && !def.readOnly ? '#bfbfbf' : '#e8e8e8',
                      cursor: def.allowEmpty && !def.readOnly ? 'pointer' : 'not-allowed',
                      padding: 4
                    }}
                    title={
                      def.readOnly
                        ? '不可修改'
                        : def.allowEmpty
                          ? '清空绑定（禁用此快捷键）'
                          : '必需绑定，不可禁用'
                    }
                    onMouseEnter={(e) => {
                      if (def.allowEmpty && !def.readOnly) e.currentTarget.style.color = '#ff4d4f'
                    }}
                    onMouseLeave={(e) => {
                      if (def.allowEmpty && !def.readOnly) e.currentTarget.style.color = '#bfbfbf'
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          /* 空态（在卡片内） */
          <div className="py-10 text-center text-[13px]" style={{ color: '#bfbfbf' }}>
            没有匹配「{query}」的命令
          </div>
        )}
      </div>

      {/* 冲突提示条 */}
      {conflictInfo && (
        <div
          className="flex items-start justify-between gap-2 rounded-[5px] px-4 py-3 mt-4"
          style={{ background: '#fffbe6', border: '1px solid #ffe58f' }}
        >
          <div className="text-[13px]" style={{ color: '#8c6d1f' }}>
            {conflictInfo.binding} 已被「{conflictInfo.others.join('、')}」使用，同时生效时先命中者执行。
          </div>
          <button
            onClick={() => setConflictInfo(null)}
            style={{ background: 'transparent', border: 'none', color: '#bfbfbf', cursor: 'pointer' }}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 危险键位提示条 */}
      {dangerBinding && (
        <div
          className="flex items-start justify-between gap-2 rounded-[5px] px-4 py-3 mt-2"
          style={{ background: '#fff2f0', border: '1px solid #ffccc7' }}
        >
          <div className="text-[13px]" style={{ color: '#8c3b38' }}>
            {dangerBinding} 存在浏览器/系统原生行为（关闭窗口、刷新等），可能干扰应用操作，建议换用其它组合。
          </div>
          <button
            onClick={() => setDangerBinding(null)}
            style={{ background: 'transparent', border: 'none', color: '#bfbfbf', cursor: 'pointer' }}
            aria-label="关闭提示"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 录制弹窗 */}
      {recordingId && (
        <CaptureOverlay
          onCancel={() => setRecordingId(null)}
          onCapture={(binding) => {
            const id = recordingId
            setRecordingId(null)
            applyRecording(id, binding)
          }}
        />
      )}
    </div>
  )
}

// ==================================================
// 录制弹窗：全屏遮罩 + 键位捕获（e.code 物理键位，规避布局差异）
// ==================================================
function CaptureOverlay({
  onCapture,
  onCancel
}: {
  onCapture: (binding: HotkeyBinding) => void
  onCancel: () => void
}) {
  // 已按下的实时显示（提示用户当前组合）
  const [current, setCurrent] = useState<string | null>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Esc = 取消录制（不保存）
      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        onCancel()
        return
      }

      const accel = eventToAccelerator(e)
      if (accel) {
        // 有效组合：立即捕获
        onCapture(accel)
        return
      }
      // 只按了修饰键：实时显示提示
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.metaKey) parts.push('Cmd')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      setCurrent(parts.length ? `${parts.join(' + ')} + …` : '…')
    },
    [onCapture, onCancel]
  )

  // 录制期间独占键盘：window 捕获阶段监听，先于一切组件处理器
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  const overlayRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)', zIndex: 1000 }}
      onMouseDown={(e) => {
        // 点击遮罩取消
        if (e.target === overlayRef.current) onCancel()
      }}
    >
      <div
        className="rounded-[8px] flex flex-col items-center gap-4"
        style={{ background: '#fff', padding: '28px 40px', minWidth: 380 }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: '#262626' }}>请按下新的快捷键组合</div>

        {/* 实时键位显示 */}
        <div
          className="flex items-center justify-center rounded-[5px]"
          style={{
            minWidth: 180,
            height: 40,
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            fontSize: 14,
            color: current ? '#595959' : '#bfbfbf'
          }}
        >
          {current ?? '等待输入…'}
        </div>

        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
          按 Esc 取消录制；仅含修饰键的组合不会保存
        </div>

        <button
          onClick={onCancel}
          className="rounded-[5px]"
          style={{
            padding: '5px 16px',
            fontSize: 13,
            background: '#fff',
            border: '1px solid #d9d9d9',
            color: '#595959',
            cursor: 'pointer'
          }}
        >
          取消
        </button>
      </div>
    </div>
  )
}
