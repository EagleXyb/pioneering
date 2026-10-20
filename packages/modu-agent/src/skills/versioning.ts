// skills/versioning.ts
//
// P1-b（L3-2）：内容寻址 + 版本快照 + 默认版本指针。
//
// 为什么需要：
//   - 管理面会写入「启用哪些技能」，但技能内容本身也会变（改了 prompt / 换了工具）；
//   - 没有内容指纹就无法回答「线上跑的是哪一版」，也无法回滚。
//
// 设计（对齐全量方案 9.3）：
//   - `contentHash` = sha256(排序后的相对路径 + 文件内容)，同内容必同指纹；
//   - 快照落在 `<base>/.snapshots/<name>/<version>+<hash8>`（只读语义：写入后不再改）；
//   - 版本状态落在 `<base>/.state.json`：`{ [name]: { defaultVersion, versions } }`；
//   - 同版本内容变化 → 记为冲突（不静默切换默认版本），由调用方告警；
//   - 回滚只改指针，不动工作目录（下次 `discover` 会从快照加载）。
//
// 所有函数对异常保持容忍：版本能力是增强项，失败不得阻断技能发现。
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[skills.versioning] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[skills.versioning] ${msg}`, ...args),
}

/** 单次发现得到的技能元信息（供路由展示 / 冲突计算）。 */
export interface SkillMeta {
  name: string
  version: string
  contentHash: string
  /** 技能所在目录（快照加载时为快照目录） */
  sourcePath: string
  /** 所属扫描根目录（回滚需要） */
  baseDir: string
  /** 是否从快照加载 */
  fromSnapshot: boolean
  /** manifest 校验/加载错误（用于 GET /skills 展示） */
  error?: string
}

const _meta = new Map<string, SkillMeta>()

export function setSkillMeta(meta: SkillMeta): void {
  _meta.set(meta.name, meta)
}

export function getSkillMeta(name: string): SkillMeta | undefined {
  return _meta.get(name)
}

export function listSkillMeta(): SkillMeta[] {
  return [..._meta.values()]
}

export function resetSkillMetaForTest(): void {
  _meta.clear()
}

/** 递归列出目录内文件（相对路径，排序；跳过点目录 / node_modules）。 */
export function listSkillFiles(dir: string, root = dir): string[] {
  const out: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const name = entry.name
    if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') continue
    const abs = path.join(dir, name)
    if (entry.isDirectory()) {
      out.push(...listSkillFiles(abs, root))
    } else if (entry.isFile()) {
      out.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  return out.sort()
}

/** 计算技能目录的内容指纹（sha256）。目录不存在 / 无文件时返回空串。 */
export function computeSkillContentHash(dir: string): string {
  const files = listSkillFiles(dir)
  if (files.length === 0) return ''
  const hash = crypto.createHash('sha256')
  for (const rel of files) {
    hash.update(rel)
    hash.update('\n')
    try {
      hash.update(fs.readFileSync(path.join(dir, rel)))
    } catch {
      hash.update('')
    }
    hash.update('\n')
  }
  return hash.digest('hex')
}

// ============================================================
// 版本状态（<base>/.state.json）
// ============================================================

export interface SkillVersionEntry {
  hash: string
  snapshot: string
  createdAt: string
}

export interface SkillVersionRecord {
  defaultVersion: string
  versions: Record<string, SkillVersionEntry>
  /**
   * 是否被显式回滚"钉住"。
   * - false（默认）：工作副本升版本时自动前移 defaultVersion（正常升级）；
   * - true：只有再次显式 setDefaultVersion 才会切换（回滚语义）。
   */
  pinned?: boolean
}

export type SkillVersionState = Record<string, SkillVersionRecord>

export function versionStatePath(baseDir: string): string {
  return path.join(baseDir, '.state.json')
}

export function readVersionState(baseDir: string): SkillVersionState {
  try {
    const file = versionStatePath(baseDir)
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as SkillVersionState) : {}
  } catch (e: any) {
    logger.warning('read version state failed (%s): %s', baseDir, String(e?.message ?? e))
    return {}
  }
}

export function writeVersionState(baseDir: string, state: SkillVersionState): void {
  const file = versionStatePath(baseDir)
  fs.mkdirSync(baseDir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

// ============================================================
// 快照
// ============================================================

export function snapshotDirFor(
  baseDir: string,
  name: string,
  version: string,
  hash: string,
): string {
  return path.join(baseDir, '.snapshots', name, `${version}+${hash.slice(0, 8)}`)
}

/**
 * 确保某版本快照存在（不存在则从 sourceDir 复制）。
 *
 * @returns 快照目录；失败返回 null（不阻断发现）
 */
export function ensureSnapshot(
  baseDir: string,
  name: string,
  version: string,
  hash: string,
  sourceDir: string,
): string | null {
  const dest = snapshotDirFor(baseDir, name, version, hash)
  try {
    if (fs.existsSync(dest)) return dest
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(sourceDir, dest, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src)
        return !(base.startsWith('.') || base === 'node_modules' || base === '__pycache__')
      },
    })
    logger.info('snapshot created: %s (%s@%s)', dest, name, version)
    return dest
  } catch (e: any) {
    logger.warning('snapshot failed (%s@%s): %s', name, version, String(e?.message ?? e))
    return null
  }
}

/** 查找某版本的快照目录（按 `<version>+*` 前缀）。 */
export function findSnapshot(baseDir: string, name: string, version: string): string | null {
  const root = path.join(baseDir, '.snapshots', name)
  try {
    if (!fs.existsSync(root)) return null
    const hit = fs
      .readdirSync(root, { withFileTypes: true })
      .find((d) => d.isDirectory() && d.name.startsWith(`${version}+`))
    return hit ? path.join(root, hit.name) : null
  } catch {
    return null
  }
}

/**
 * 记录版本（幂等）：同 hash 直接返回；同版本不同 hash 视为「版本未递增」冲突。
 *
 * @returns `{ defaultVersion, conflict }`
 */
export function recordVersion(
  baseDir: string,
  name: string,
  version: string,
  hash: string,
): { defaultVersion: string; conflict: boolean } {
  const state = readVersionState(baseDir)
  const record = state[name] ?? { defaultVersion: '', versions: {} }
  const existing = record.versions[version]

  if (existing && existing.hash !== hash) {
    // 同版本不同内容：不静默切换（审计黑洞），保持原默认版本
    logger.warning(
      "skill '%s' version %s content changed without version bump (old=%s new=%s)",
      name, version, existing.hash.slice(0, 8), hash.slice(0, 8),
    )
    state[name] = record
    writeVersionState(baseDir, state)
    return { defaultVersion: record.defaultVersion || version, conflict: true }
  }

  const snapshot = existing?.snapshot ?? snapshotDirFor(baseDir, name, version, hash)
  record.versions[version] = {
    hash,
    snapshot,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
  // 正常升级：未被回滚钉住时，默认版本随工作副本前移
  if (!record.defaultVersion || (!record.pinned && record.defaultVersion !== version)) {
    record.defaultVersion = version
  }
  state[name] = record
  writeVersionState(baseDir, state)
  return { defaultVersion: record.defaultVersion, conflict: false }
}

export interface CleanupSnapshotsOptions {
  /** 每个技能保留最近 N 个快照（默认 5） */
  keepLast?: number
  /** 超过 N 天的快照删除（默认 90；0 表示不按时间） */
  maxAgeDays?: number
  /** 只计算不删除 */
  dryRun?: boolean
}

/**
 * 快照回收（L4-5.2）。
 *
 * 规则：**默认版本快照永不删除**；其余按 mtime 倒序保留 `keepLast` 个，
 * 且删除超过 `maxAgeDays` 的。目录不存在时返回空结果（不抛异常）。
 */
export function cleanupSnapshots(
  baseDir: string,
  opts: CleanupSnapshotsOptions = {},
): { removed: string[]; kept: number } {
  const keepLast = Math.max(1, Number(opts.keepLast ?? 5))
  const maxAgeMs = Math.max(0, Number(opts.maxAgeDays ?? 90)) * 24 * 60 * 60 * 1000
  const state = readVersionState(baseDir)
  const root = path.join(baseDir, '.snapshots')
  const removed: string[] = []
  let kept = 0

  let names: string[] = []
  try {
    if (!fs.existsSync(root)) return { removed, kept }
    names = fs.readdirSync(root)
  } catch {
    return { removed, kept }
  }

  for (const name of names) {
    const dir = path.join(root, name)
    let entries: Array<{ fileName: string; abs: string; mtime: number }> = []
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const abs = path.join(dir, d.name)
          let mtime = 0
          try {
            mtime = fs.statSync(abs).mtimeMs
          } catch {
            mtime = 0
          }
          return { fileName: d.name, abs, mtime }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      continue
    }

    const defaultVersion = state[name]?.defaultVersion
    entries.forEach((entry, index) => {
      if (defaultVersion && entry.fileName.startsWith(`${defaultVersion}+`)) {
        kept += 1
        return
      }
      const tooOld = maxAgeMs > 0 && Date.now() - entry.mtime > maxAgeMs
      const tooMany = index >= keepLast
      if (!tooMany && !tooOld) {
        kept += 1
        return
      }
      if (!opts.dryRun) {
        try {
          fs.rmSync(entry.abs, { recursive: true, force: true })
        } catch (e: any) {
          logger.warning('cleanup snapshot failed (%s): %s', entry.abs, String(e?.message ?? e))
          return
        }
      }
      removed.push(path.relative(baseDir, entry.abs).split(path.sep).join('/'))
    })
  }

  if (removed.length > 0) {
    logger.info('snapshots cleaned: removed=%d kept=%d (dryRun=%s)', removed.length, kept, Boolean(opts.dryRun))
  }
  return { removed, kept }
}

/** 回滚：仅改默认版本指针（下一次 discover 从快照加载）。 */
export function setDefaultVersion(
  baseDir: string,
  name: string,
  version: string,
): { ok: boolean; message: string; snapshot: string | null } {
  const state = readVersionState(baseDir)
  const record = state[name]
  if (!record) return { ok: false, message: `技能 '${name}' 没有版本记录`, snapshot: null }
  if (!record.versions[version]) {
    return { ok: false, message: `技能 '${name}' 不存在版本 '${version}'`, snapshot: null }
  }
  record.defaultVersion = version
  // 显式回滚：钉住指针，避免下次扫描被工作副本"自动升级"覆盖
  record.pinned = true
  state[name] = record
  writeVersionState(baseDir, state)
  const snapshot = findSnapshot(baseDir, name, version)
  return { ok: true, message: `已回滚到 ${name}@${version}`, snapshot }
}
