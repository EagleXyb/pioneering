// ============================================================
// input-drafts — 输入草稿持久化（数据层，对应文档 §11）
// 通过 storeApi（Key-Value 持久化）保存/恢复输入框内容。
// 不依赖主进程 SQLite，沿用现有 store:get/set/delete IPC 通道。
//
// T9 修复（修复任务清单 T9 / 报告 §2.4）：
//   图片附件（单张 ≤20MB，data URL base64）不再随草稿 JSON 写入 electron-store
//   （主进程 JSON 往返 + 同步整档落盘，400ms 级高频保存会阻塞主进程）。
//   图片经 draftAsset 收窄通道异步外置到 userData/draft-assets/<id>（二进制），
//   草稿仅保存 { id, mediaType, assetId } 引用；恢复时按引用读回重组 data URL。
//   通道不可用（纯浏览器 dev / IPC 异常）时回退内联 dataUrl，
//   并以 DRAFT_STORE_MAX_CHARS 体积阈值兜底：超阈值丢弃内联图片，
//   杜绝大对象走 STORE_SET 同步落盘。
// ============================================================

import { storeApi, draftAssetApi } from '@/services/ipc'
import type { ImageAttachment } from './image-attachments'
import type { SelectedFileItem } from './select-file-editor'

export interface InputDraftValue {
  /** 序列化文本（含 @{} 标签） */
  text: string
  images: ImageAttachment[]
  /** 当前选中的 Skill 名称 */
  skill: string | null
  /** 选中的文件列表 */
  selectedFiles: SelectedFileItem[]
}

/** 落盘形态的图片：外置引用优先，通道失败时内联兜底 */
interface StoredDraftImage {
  id: string
  mediaType: string
  /** 外置资产 id（= 图片附件 id，对应主进程 userData/draft-assets/<id>） */
  assetId?: string
  /** 兜底内联 data URL（仅资产通道不可用时出现） */
  dataUrl?: string
}

/** 草稿在 electron-store 中的实际落盘结构 */
interface StoredDraftValue {
  text: string
  images: StoredDraftImage[]
  skill: string | null
  selectedFiles: SelectedFileItem[]
}

/**
 * 内联兜底图片允许的草稿 JSON 体积上限。
 * 正常外置成功时 JSON 只含短引用（远小于此值）；仅当资产通道失败回退内联、
 * 且整档超过该阈值时，丢弃内联图片（内存附件不受影响，仅重启后不可恢复）。
 */
const DRAFT_STORE_MAX_CHARS = 256 * 1024

const DRAFT_PREFIX = 'input-draft'

// ---- 草稿键 ----
export function getSessionInputDraftKey(sessionId: string): string {
  return `${DRAFT_PREFIX}:session:${sessionId}`
}

// ---- 资产外置记账（模块级单例）----
/** 本进程生命周期内已成功外置的资产 id：同一张图不重复写盘 */
const externalizedIds = new Set<string>()
/** 每个草稿键已持久化的外置资产引用（保存新版本后用于清理孤儿文件） */
const keyAssetRefs = new Map<string, Set<string>>()
/** 每个草稿键的串行队列：避免定时保存与卸载冲刷/删除并发竞争 */
const keyChains = new Map<string, Promise<unknown>>()

function enqueueKey<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = keyChains.get(key) ?? Promise.resolve()
  const next = prev.then(task, task)
  keyChains.set(key, next)
  next
    .finally(() => {
      if (keyChains.get(key) === next) keyChains.delete(key)
    })
    .catch(() => {})
  return next
}

/** 把图片附件外置为资产文件；失败时回退内联 dataUrl */
async function externalizeImage(img: ImageAttachment): Promise<StoredDraftImage> {
  if (externalizedIds.has(img.id)) {
    return { id: img.id, mediaType: img.mediaType, assetId: img.id }
  }
  try {
    const res = await draftAssetApi.write({
      id: img.id,
      mediaType: img.mediaType,
      dataUrl: img.dataUrl
    })
    if (res?.success) {
      externalizedIds.add(img.id)
      return { id: img.id, mediaType: img.mediaType, assetId: img.id }
    }
  } catch {
    // IPC 不可用等异常：落到内联兜底
  }
  return { id: img.id, mediaType: img.mediaType, dataUrl: img.dataUrl }
}

/** 按引用把落盘图片恢复为内存 ImageAttachment；资产丢失的条目跳过 */
async function restoreImage(img: StoredDraftImage): Promise<ImageAttachment | null> {
  if (img.dataUrl) {
    return { id: img.id, mediaType: img.mediaType, dataUrl: img.dataUrl }
  }
  if (!img.assetId) return null
  try {
    const res = await draftAssetApi.read(img.assetId)
    if (res?.success && res.base64) {
      return {
        id: img.id,
        mediaType: img.mediaType,
        dataUrl: `data:${img.mediaType};base64,${res.base64}`
      }
    }
  } catch {
    // 资产文件丢失（如被清理工具删除）：该图不可恢复
  }
  return null
}

// ---- 读写（带 Promise 容错）----
async function readRaw(key: string): Promise<StoredDraftValue | null> {
  try {
    const result = await storeApi.get<unknown>(key)
    if (result && typeof result === 'object' && Array.isArray((result as StoredDraftValue).images)) {
      return result as StoredDraftValue
    }
    return null
  } catch {
    return null
  }
}

async function writeRaw(key: string, value: StoredDraftValue): Promise<boolean> {
  try {
    return (await storeApi.set(key, value)) !== false
  } catch {
    return false
  }
}

async function deleteRaw(key: string): Promise<void> {
  try {
    await storeApi.delete(key)
  } catch {
    /* 忽略 */
  }
}

/** 删除草稿键维度不再被引用的外置资产（孤儿清理） */
function reconcileAssets(key: string, next: Set<string>): void {
  const prev = keyAssetRefs.get(key)
  if (prev) {
    for (const id of prev) {
      if (!next.has(id)) {
        externalizedIds.delete(id)
        void draftAssetApi.delete(id).catch(() => {})
      }
    }
  }
  keyAssetRefs.set(key, next)
}

export function saveInputDraft(key: string, value: InputDraftValue): Promise<void> {
  return enqueueKey(key, async () => {
    // 1) 图片外置（同一张图仅写一次）；失败回退内联
    const storedImages = await Promise.all(value.images.map(externalizeImage))
    let stored: StoredDraftValue = {
      text: value.text,
      images: storedImages,
      skill: value.skill,
      selectedFiles: value.selectedFiles
    }

    // 2) 体积阈值兜底：回退内联导致整档超阈值时，剥离内联图片仅保留引用与文本
    if (JSON.stringify(stored).length > DRAFT_STORE_MAX_CHARS) {
      stored = { ...stored, images: stored.images.filter((i) => !i.dataUrl) }
    }

    // 3) 落盘（electron-store 同步写只承载小体积 JSON）
    const ok = await writeRaw(key, stored)
    if (!ok) return

    // 4) 清理本键上一版已移除的资产文件
    const next = new Set(
      stored.images.filter((i) => i.assetId).map((i) => i.assetId as string)
    )
    reconcileAssets(key, next)
  })
}

export function loadInputDraft(key: string): Promise<InputDraftValue | null> {
  return enqueueKey(key, async () => {
    const raw = await readRaw(key)
    if (!raw) return null
    const restored = await Promise.all((raw.images ?? []).map(restoreImage))
    const images = restored.filter((x): x is ImageAttachment => x !== null)
    // 登记当前引用集合，供后续保存时做孤儿清理
    keyAssetRefs.set(
      key,
      new Set(
        raw.images
          .filter((i) => i.assetId)
          .map((i) => i.assetId as string)
      )
    )
    return {
      text: typeof raw.text === 'string' ? raw.text : '',
      images,
      skill: raw.skill ?? null,
      selectedFiles: Array.isArray(raw.selectedFiles) ? raw.selectedFiles : []
    }
  })
}

export function removeInputDraft(key: string): Promise<void> {
  return enqueueKey(key, async () => {
    // 删除草稿时一并清理其全部外置资产，避免废弃图片长期占盘
    const refs = keyAssetRefs.get(key)
    if (refs) {
      for (const id of refs) {
        externalizedIds.delete(id)
        try {
          await draftAssetApi.delete(id)
        } catch {
          /* 忽略 */
        }
      }
      keyAssetRefs.delete(key)
    }
    await deleteRaw(key)
  })
}

/** 判断草稿是否为空（无需持久化）。 */
export function isDraftEmpty(draft: InputDraftValue): boolean {
  return (
    !draft.text.trim() &&
    draft.images.length === 0 &&
    !draft.skill &&
    draft.selectedFiles.length === 0
  )
}
