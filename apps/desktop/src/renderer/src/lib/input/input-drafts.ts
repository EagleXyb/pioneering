// ============================================================
// input-drafts — 输入草稿持久化（数据层，对应文档 §11）
// 通过 storeApi（Key-Value 持久化）保存/恢复输入框内容。
// 不依赖主进程 SQLite，沿用现有 store:get/set/delete IPC 通道。
// ============================================================

import { storeApi } from '@/services/ipc'
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

const DRAFT_PREFIX = 'input-draft'

// ---- 草稿键 ----
export function getSessionInputDraftKey(sessionId: string): string {
  return `${DRAFT_PREFIX}:session:${sessionId}`
}

export function getHomeInputDraftKey(mode: string): string {
  return `${DRAFT_PREFIX}:home:${mode}`
}

export function getProjectInputDraftKey(projectId: string, mode: string): string {
  return `${DRAFT_PREFIX}:project:${projectId}:${mode}`
}

// ---- 读写（带 Promise 容错）----
async function readRaw(key: string): Promise<InputDraftValue | null> {
  try {
    const result = await storeApi.get<InputDraftValue>(key)
    return result ?? null
  } catch {
    return null
  }
}

async function writeRaw(key: string, value: InputDraftValue): Promise<void> {
  try {
    await storeApi.set(key, value)
  } catch {
    /* 持久化失败不影响输入体验 */
  }
}

async function deleteRaw(key: string): Promise<void> {
  try {
    await storeApi.delete(key)
  } catch {
    /* 忽略 */
  }
}

export async function saveInputDraft(key: string, value: InputDraftValue): Promise<void> {
  await writeRaw(key, value)
}

export async function loadInputDraft(key: string): Promise<InputDraftValue | null> {
  return readRaw(key)
}

export async function removeInputDraft(key: string): Promise<void> {
  await deleteRaw(key)
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
