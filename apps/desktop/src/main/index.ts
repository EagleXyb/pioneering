import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { getWindowOptions } from './window-config'
import { buildAppMenu } from './menu'
import { IpcChannel } from '../shared/ipc-channels'
import appIcon from '../../resources/icon.png?asset'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: appIcon,
    // 按平台返回 frame / titleBarStyle，详见 window-config.ts
    ...getWindowOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // 注意：sandbox 必须为 false。
      // 当前 preload 使用 ESM（import/export）语法，而 Electron 沙箱模式下
      // 的 preload 不支持 ES module 语法（会报 "Cannot use import statement
      // outside a module" 导致 preload 加载失败、window.api 为 undefined、
      // 渲染进程崩溃白屏）。contextIsolation:true + nodeIntegration:false
      // 已提供足够的安全隔离，故保持 sandbox:false。
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

  return mainWindow
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pioneering.desktop')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()

  const mainWindow = createWindow()

  // macOS：菜单挂到屏幕顶部全局栏（窗口外），仅一行平台分支
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(buildAppMenu(mainWindow))
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
