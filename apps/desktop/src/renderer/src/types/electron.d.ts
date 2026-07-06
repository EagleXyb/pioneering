export {}

declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
        on: (channel: string, callback: (...args: unknown[]) => void) => void
        removeAllListeners: (channel: string) => void
      }
    }
    electronAPI?: {
      platform: string
      versions: Record<string, string>
    }
  }
}
