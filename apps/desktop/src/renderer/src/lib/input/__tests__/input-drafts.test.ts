// T9 回归测试：草稿图片资产外置 / 恢复 / 孤儿清理 / 内联兜底 / 体积阈值
//
// 在 node 环境用内存 Map 模拟 window.api.store（electron-store）与
// window.api.draftAsset（userData/draft-assets 文件），验证：
//   1. 保存时图片 dataUrl 不进入草稿 JSON，仅存引用；同一图不重复写资产
//   2. 恢复时按引用读回重组 data URL，缩略图可还原
//   3. 移除图片/删除草稿会清理孤儿资产文件
//   4. 资产通道失败 → 回退内联；整档超阈值 → 剥离内联图片
//   5. 兼容旧版草稿（图片直接内联 dataUrl，无 assetId）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveInputDraft,
  loadInputDraft,
  removeInputDraft,
  type InputDraftValue
} from '@/lib/input/input-drafts'

// ---- 内存版 window.api ----
interface StoredAsset {
  mediaType: string
  base64: string
}

let storeMap: Map<string, unknown>
let assetMap: Map<string, StoredAsset>
let writeSpy: ReturnType<typeof vi.fn>
let readSpy: ReturnType<typeof vi.fn>
let deleteSpy: ReturnType<typeof vi.fn>
let writeShouldFail: boolean

const DATA_URL_PATTERN = /^data:([^;]+);base64,([\s\S]*)$/

function installWindowApi() {
  storeMap = new Map()
  assetMap = new Map()
  writeShouldFail = false
  writeSpy = vi.fn(async (req: { id: string; mediaType: string; dataUrl: string }) => {
    if (writeShouldFail) return { success: false, error: 'mock failure' }
    const m = DATA_URL_PATTERN.exec(req.dataUrl)
    if (!m) return { success: false, error: 'bad data url' }
    assetMap.set(req.id, { mediaType: m[1]!, base64: m[2]! })
    return { success: true }
  })
  readSpy = vi.fn(async (id: string) => {
    const a = assetMap.get(id)
    return a ? { success: true, base64: a.base64 } : { success: false, error: 'not found' }
  })
  deleteSpy = vi.fn(async (id: string) => {
    assetMap.delete(id)
    return { success: true }
  })
  ;(globalThis as Record<string, unknown>).window = {
    api: {
      store: {
        get: vi.fn(async (k: string) => storeMap.get(k)),
        set: vi.fn(async (k: string, v: unknown) => {
          storeMap.set(k, JSON.parse(JSON.stringify(v)))
          return true
        }),
        delete: vi.fn(async (k: string) => {
          storeMap.delete(k)
          return true
        })
      },
      draftAsset: { write: writeSpy, read: readSpy, delete: deleteSpy }
    }
  }
}

function makeDraft(dataUrl: string, id = 'img-1'): InputDraftValue {
  return {
    text: '带图草稿',
    images: [{ id, mediaType: 'image/png', dataUrl }],
    skill: null,
    selectedFiles: []
  }
}

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('input-drafts 图片外置（T9）', () => {
  beforeEach(installWindowApi)

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
    vi.restoreAllMocks()
  })

  it('保存后草稿 JSON 仅含资产引用，不含 dataUrl；同一图不重复写资产', async () => {
    const key = 'input-draft:session:s1'
    await saveInputDraft(key, makeDraft(tinyPng))
    const stored = storeMap.get(key) as { images: Array<{ assetId?: string; dataUrl?: string }> }
    expect(stored.images[0]!.assetId).toBe('img-1')
    expect(stored.images[0]!.dataUrl).toBeUndefined()
    expect(writeSpy).toHaveBeenCalledTimes(1)

    // 再次保存同一图（模拟连续输入）：资产写一次，不再产生大 IPC 负载
    await saveInputDraft(key, makeDraft(tinyPng))
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(assetMap.has('img-1')).toBe(true)
  })

  it('恢复草稿按引用读回资产并重组 data URL，缩略图可还原', async () => {
    const key = 'input-draft:session:s2'
    await saveInputDraft(key, makeDraft(tinyPng, 'img-restore'))
    const restored = await loadInputDraft(key)
    expect(restored?.text).toBe('带图草稿')
    expect(restored?.images[0]!.dataUrl).toBe(tinyPng)
    expect(readSpy).toHaveBeenCalledWith('img-restore')
  })

  it('移除图片后再保存：旧资产被孤儿清理；删除草稿清空全部资产', async () => {
    const key = 'input-draft:session:s3'
    await saveInputDraft(
      key,
      {
        text: '两图',
        images: [
          { id: 'img-a', mediaType: 'image/png', dataUrl: tinyPng },
          { id: 'img-b', mediaType: 'image/gif', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAM7OzP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' }
        ],
        skill: null,
        selectedFiles: []
      }
    )
    expect(assetMap.size).toBe(2)

    await saveInputDraft(key, { text: '一图', images: [{ id: 'img-a', mediaType: 'image/png', dataUrl: tinyPng }], skill: null, selectedFiles: [] })
    expect(deleteSpy).toHaveBeenCalledWith('img-b')
    expect(assetMap.has('img-b')).toBe(false)
    expect(assetMap.has('img-a')).toBe(true)

    await removeInputDraft(key)
    expect(storeMap.has(key)).toBe(false)
    expect(assetMap.size).toBe(0)
  })

  it('资产通道失败时回退内联 dataUrl（小图，浏览器模式/IPC 异常兜底）', async () => {
    writeShouldFail = true
    const key = 'input-draft:session:s4'
    await saveInputDraft(key, makeDraft(tinyPng, 'img-fallback'))
    const stored = storeMap.get(key) as { images: Array<{ assetId?: string; dataUrl?: string }> }
    expect(stored.images[0]!.dataUrl).toBe(tinyPng)
    expect(stored.images[0]!.assetId).toBeUndefined()

    // 内联旧草稿可直接恢复，不调用资产读取
    const restored = await loadInputDraft(key)
    expect(restored?.images[0]!.dataUrl).toBe(tinyPng)
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('回退内联且整档超体积阈值时剥离内联图片，仅保留文本与引用', async () => {
    writeShouldFail = true
    const key = 'input-draft:session:s5'
    // ~300KB 的 dataUrl，超过 256KB 阈值
    const huge = `data:image/png;base64,${'A'.repeat(300 * 1024)}`
    await saveInputDraft(key, makeDraft(huge, 'img-big'))
    const stored = storeMap.get(key) as { text: string; images: unknown[] }
    expect(stored.text).toBe('带图草稿')
    expect(stored.images).toEqual([])
  })

  it('兼容旧版草稿结构（图片直接内联 dataUrl，无 assetId）', async () => {
    const key = 'input-draft:session:s6'
    storeMap.set(key, {
      text: '旧草稿',
      images: [{ id: 'old-1', mediaType: 'image/webp', dataUrl: tinyPng }],
      skill: null,
      selectedFiles: []
    })
    const restored = await loadInputDraft(key)
    expect(restored?.images).toHaveLength(1)
    expect(restored?.images[0]!.id).toBe('old-1')
    expect(restored?.images[0]!.dataUrl).toBe(tinyPng)
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('资产文件丢失（读取失败）时恢复不报错，跳过该图', async () => {
    const key = 'input-draft:session:s7'
    storeMap.set(key, {
      text: '资产丢失',
      images: [{ id: 'gone', mediaType: 'image/png', assetId: 'gone' }],
      skill: null,
      selectedFiles: []
    })
    const restored = await loadInputDraft(key)
    expect(restored?.text).toBe('资产丢失')
    expect(restored?.images).toEqual([])
  })
})
