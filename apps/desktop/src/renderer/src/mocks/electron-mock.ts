/**
 * Electron API 浏览器端 Mock
 *
 * 在浏览器环境中模拟 preload 脚本通过 contextBridge 暴露的 window.api 和 window.electron，
 * 使桌面应用的渲染进程可以独立在浏览器中开发和调试。
 *
 * 所有实际功能（窗口控制、文件系统等）在浏览器中不可用，
 * 但返回安全的默认值，确保应用不会崩溃。
 */

const noop = () => {}
const noopAsync = () => Promise.resolve()

// ---- localStorage 持久化，模拟 Electron store ----
function getStore() {
  try {
    const raw = localStorage.getItem('__electron_mock_store__')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStore(data: Record<string, unknown>) {
  try {
    localStorage.setItem('__electron_mock_store__', JSON.stringify(data))
  } catch {
    // localStorage 可能不可用
  }
}

// ---- 构建 mock 对象 ----
const mockApi: PioneeringApi = {
  window: {
    minimize: noopAsync,
    maximize: noopAsync,
    close: noopAsync,
    isMaximized: () => Promise.resolve(false),
    toggleFullscreen: noopAsync,
    toggleDevTools: noopAsync,
    startDrag: noop,
    moveDrag: noop,
    endDrag: noop,
    onMaximizedChange: (_callback: (maximized: boolean) => void) => noop,
    onFullscreenChange: (_callback: (fullscreen: boolean) => void) => noop
  },

  app: {
    getVersion: () => Promise.resolve('0.0.0-browser'),
    getPlatform: () => Promise.resolve('windows'),
    quit: noopAsync,
    checkUpdate: () => Promise.resolve('0.0.0'),
    networkCheck: () => Promise.resolve(true),
    setApiBaseUrl: (_url: string) => Promise.resolve(true),
    openLogDir: () => Promise.resolve(''),
    onMenuAction: (_callback: (id: string) => void) => noop
  },

  file: {
    openDialog: (_options: unknown) =>
      Promise.resolve({ canceled: true, filePaths: [] }),
    saveDialog: (_options: unknown) =>
      Promise.resolve({ canceled: true, filePaths: [] }),
    read: (_filePath: string) =>
      Promise.resolve({ success: false, error: 'IPC not available in browser' }),
    write: (_req: unknown) =>
      Promise.resolve({ success: false, error: 'IPC not available in browser' }),
    getPath: (_name: string) => Promise.resolve(''),
    showInFolder: (_filePath?: string) => Promise.resolve(false)
  },

  notification: {
    show: async (_options: unknown) => {
      console.log('[Mock Notification]', _options)
    }
  },

  clipboard: {
    write: async (_text: string) => {
      await navigator.clipboard.writeText(_text).catch(noop)
    },
    read: () => navigator.clipboard.readText().catch(() => '')
  },

  shell: {
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  },

  store: {
    get: <T = unknown>(key: string): Promise<T | undefined> => {
      const store = getStore()
      return Promise.resolve(store[key] as T | undefined)
    },
    set: (key: string, value: unknown): Promise<boolean> => {
      const store = getStore()
      store[key] = value
      saveStore(store)
      return Promise.resolve(true)
    },
    delete: (key: string): Promise<boolean> => {
      const store = getStore()
      delete store[key]
      saveStore(store)
      return Promise.resolve(true)
    }
  },

  health: {
    ping: () => Promise.resolve('pong')
  },

  // 浏览器模式无本地 Agent 运行时（主进程 IPC 不存在）：
  // 提供安全桩——ipc 模式下调用会得到明确错误而非崩溃
  agent: {
    send: (_runId: string, _request: unknown) =>
      Promise.resolve({ ok: false, error: '本地 Agent 运行时仅在 Electron 桌面端可用' }),
    resume: (_runId: string, _request: unknown) =>
      Promise.resolve({ ok: false, error: '本地 Agent 运行时仅在 Electron 桌面端可用' }),
    abort: (_sessionId: string, _reason?: string) =>
      Promise.resolve({ message: 'unsupported in browser', aborted: false }),
    state: (threadId: string) =>
      Promise.resolve({ session_id: threadId, pending: false }),
    stop: (_sessionId: string) =>
      Promise.resolve({ message: 'unsupported in browser', aborted: false }),
    onEvent: (_callback: (envelope: never) => void) => noop
  },

  // 云边双模阶段 2：本地持久化 / 密钥 / 上传 IPC 桩——
  // 浏览器模式无主进程，统一返回 ok:false 降级错误而非崩溃
  localChat: {
    listSessions: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    createSession: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    updateSession: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    deleteSession: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    listMessages: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    appendMessages: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    deleteMessages: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' }),
    updateFeedback: () => Promise.resolve({ ok: false, error: '本地会话仅在 Electron 桌面端可用' })
  },

  secureKeys: {
    list: () => Promise.resolve({ keys: [], descriptors: [] }),
    set: () => Promise.resolve({ ok: false, error: '密钥管理仅在 Electron 桌面端可用' }),
    delete: () => Promise.resolve({ ok: false, error: '密钥管理仅在 Electron 桌面端可用' })
  },

  upload: {
    save: () => Promise.resolve({ ok: false, error: '本地上传仅在 Electron 桌面端可用' }),
    list: () => Promise.resolve([]),
    delete: () => Promise.resolve({ ok: false, error: '本地上传仅在 Electron 桌面端可用' })
  }
}

// ---- 注入到 window ----
if (!window.api) {
  ;(window as unknown as Record<string, unknown>).api = mockApi
}

if (!window.electron) {
  ;(window as unknown as Record<string, unknown>).electron = {
    webUtils: {
      getPathForFile: (_file: File) => null
    }
  }
}
