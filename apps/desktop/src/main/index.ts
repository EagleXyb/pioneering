import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { getWindowOptions } from './window-config'
import { IpcChannel } from '../shared/ipc-channels'
import appIcon from '../../resources/icon.png?asset'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: appIcon,
    // 按平台返回 frame / titleBarStyle，详见 window-config.ts
    ...getWindowOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 监听窗口最大化/还原状态变化，推送到渲染进程
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send(IpcChannel.WINDOW_STATE_CHANGED, true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send(IpcChannel.WINDOW_STATE_CHANGED, false)
  })

  // 监听全屏态变化，推送到渲染进程（驱动标题栏/布局自适应）
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send(IpcChannel.WINDOW_FULLSCREEN_CHANGED, true)
  })

  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send(IpcChannel.WINDOW_FULLSCREEN_CHANGED, false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pioneering.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
