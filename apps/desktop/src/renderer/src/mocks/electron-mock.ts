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
    minimize: noop,
    maximize: noop,
    close: noop,
    isMaximized: () => Promise.resolve(false),
    toggleFullscreen: noop,
    toggleDevTools: noop,
    startDrag: noop,
    moveDrag: noop,
    endDrag: noop,
    onMaximizedChange: (_callback: (maximized: boolean) => void) => noop,
    onFullscreenChange: (_callback: (fullscreen: boolean) => void) => noop
  },

  app: {
    getVersion: () => Promise.resolve('0.0.0-browser'),
    getPlatform: () => Promise.resolve('windows'),
    quit: noop,
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
    getPath: (_name: string) => Promise.resolve('')
  },

  notification: {
    show: (_options: unknown) => {
      console.log('[Mock Notification]', _options)
    }
  },

  clipboard: {
    write: (_text: string) => {
      navigator.clipboard.writeText(_text).catch(noop)
    },
    read: () => navigator.clipboard.readText().catch(() => '')
  },

  shell: {
    openExternal: (url: string) => {
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
