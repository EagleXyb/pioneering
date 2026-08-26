// ============================================================
// Upload Store — 本地上传文件治理（云边双模阶段 2）
//
// 目标：本地模式的上传不再依赖云端 POST /upload，直接写入
// userData/uploads 目录；断网可用。
//
// 安全：
//   - 文件名清洗（剥离路径分隔符与控制字符），存储名 = id + 原始名
//   - 大小上限 50MB（base64 解码后校验）
//   - 删除只接受本目录内的 id（resolve 后前缀校验），防目录穿越
// ============================================================

import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'

const logger = {
  info: (msg: string, ...args: unknown[]) => console.info(`[upload-store] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[upload-store] ${msg}`, ...args),
}

/** 单文件大小上限：50MB */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export interface UploadInfoDto {
  id: string
  fileName: string
  path: string
  size: number
  createdAt: string
}

/** 清洗文件名：去路径部分、控制字符，限长 */
function sanitizeFileName(raw: string): string {
  const base = path.basename(String(raw ?? 'file'))
    .replace(/[\0\r\n]/g, '')
    .slice(0, 200)
    .trim()
  return base || 'file'
}

export class UploadStore {
  constructor(private rootDir: string) {}

  private resolveById(id: string): string | null {
    // id 仅允许安全字符，resolve 后必须落在 rootDir 内
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
    const resolved = path.resolve(this.rootDir, id)
    if (!resolved.startsWith(this.rootDir + path.sep)) return null
    return resolved
  }

  async save(fileName: string, base64: string): Promise<{ ok: boolean; upload?: UploadInfoDto; error?: string }> {
    try {
      await mkdir(this.rootDir, { recursive: true })
    } catch (e) {
      return { ok: false, error: `创建上传目录失败：${String(e)}` }
    }
    let buf: Buffer
    try {
      buf = Buffer.from(base64, 'base64')
    } catch {
      return { ok: false, error: '文件内容不是合法的 base64' }
    }
    if (buf.length === 0) return { ok: false, error: '文件内容为空' }
    if (buf.length > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限` }
    }
    const safeName = sanitizeFileName(fileName)
    // 存储结构：uploads/<id>__<原始名>（id 前缀保证唯一 + 防重名覆盖）
    const id = randomUUID().replace(/-/g, '').slice(0, 16)
    const storedName = `${id}__${safeName}`
    const abs = path.join(this.rootDir, storedName)
    try {
      await writeFile(abs, buf)
    } catch (e) {
      logger.error('save.failed err=%s', String(e))
      return { ok: false, error: '写入文件失败' }
    }
    logger.info('saved id=%s name=%s size=%d', id, safeName, buf.length)
    return {
      ok: true,
      upload: {
        id,
        fileName: safeName,
        path: abs,
        size: buf.length,
        createdAt: new Date().toISOString(),
      },
    }
  }

  async list(): Promise<UploadInfoDto[]> {
    try {
      await mkdir(this.rootDir, { recursive: true })
      const names = await readdir(this.rootDir)
      const out: UploadInfoDto[] = []
      for (const name of names) {
        const abs = path.join(this.rootDir, name)
        try {
          const info = await stat(abs)
          if (!info.isFile()) continue
          const m = /^([A-Za-z0-9_-]+)__(.*)$/.exec(name)
          if (!m) continue
          out.push({
            id: m[1]!,
            fileName: m[2]!,
            path: abs,
            size: info.size,
            createdAt: info.mtime.toISOString(),
          })
        } catch {
          // 单文件 stat 失败跳过（并发删除等）
        }
      }
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return out
    } catch {
      return []
    }
  }

  async delete(id: string): Promise<{ ok: boolean; error?: string }> {
    const abs = this.resolveById(id)
    if (!abs) return { ok: false, error: '非法的文件标识' }
    try {
      const files = await readdir(this.rootDir)
      const target = files.find((f) => f.startsWith(id + '__'))
      if (!target) return { ok: false, error: '文件不存在' }
      await unlink(path.join(this.rootDir, target))
      logger.info('deleted id=%s', id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: `删除失败：${String(e)}` }
    }
  }

  /** 按原始名前缀查找（渲染端消息附件展示用；可空） */
  async findByNamePrefix(prefix: string): Promise<UploadInfoDto[]> {
    const all = await this.list()
    if (!prefix) return all
    return all.filter((u) => u.fileName.includes(prefix))
  }

  /** 读取文件内容（base64；供渲染端回显附件） */
  async readBase64(id: string): Promise<string | null> {
    try {
      const files = await readdir(this.rootDir)
      const target = files.find((f) => f.startsWith(id + '__'))
      if (!target) return null
      const buf = await readFile(path.join(this.rootDir, target))
      return buf.toString('base64')
    } catch {
      return null
    }
  }
}

// ---- 单例 ----

let _store: UploadStore | null = null

export function getUploadStore(rootDir: string): UploadStore {
  if (!_store) _store = new UploadStore(rootDir)
  return _store
}
