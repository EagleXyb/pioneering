// ============================================================
// drag-folder — 拖拽路径解析（对应文档 §7）
// Electron 36 起 File.path 被移除，需经 preload 暴露的
// webUtils.getPathForFile 还原本地路径；同时兼容旧版 File.path。
// ============================================================

/**
 * 从拖拽的 DataTransfer 中提取本地文件路径。
 * 优先使用 webUtils.getPathForFile，回退到 File.path，最后返回空数组。
 */
export function getDroppedLocalPaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer || !dataTransfer.files || dataTransfer.files.length === 0) return []

  const getPathForFile = (window as unknown as {
    electron?: { webUtils?: { getPathForFile?: (file: File) => string | null } }
  })?.electron?.webUtils?.getPathForFile

  const paths: string[] = []
  for (const file of Array.from(dataTransfer.files)) {
    let resolved: string | null | undefined
    if (typeof getPathForFile === 'function') {
      try {
        resolved = getPathForFile(file)
      } catch {
        resolved = undefined
      }
    }
    if (!resolved && 'path' in file) {
      resolved = (file as unknown as { path?: string }).path
    }
    if (resolved) paths.push(resolved)
  }
  return paths
}

/** 内部文件拖拽 MIME（用于会话内文件引用拖拽识别）。 */
export const INTERNAL_FILE_DRAG_MIME = 'application/x-opencowork-file-refs'

/** 从内部拖拽 MIME 中读取文件路径列表。 */
export function getDraggedFilePaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer || !dataTransfer.getData) return []
  const raw = dataTransfer.getData(INTERNAL_FILE_DRAG_MIME)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    /* ignore */
  }
  return []
}
