import { app, shell, BrowserWindow, Menu, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc-handlers'
import { getWindowOptions } from './window-config'
import { buildAppMenu } from './menu'
import { IpcChannel } from '../shared/ipc-channels'
import appIcon from '../../resources/icon.png?asset'

// macOS 顶部全局菜单的 App 菜单标题由运行时的进程/Bundle 显示名决定。
// 开发期直接运行 Electron 二进制，默认显示为 "Electron"；
// 此处显式设置 app.name，使菜单栏在开发期也显示为 "Pioneering"。
// 注：必须在 app.whenReady() 之前设置才生效。
app.name = 'Pioneering'

// 文档生成产物根目录：打包态下由 desktop 主进程注入为 userData/Documents，
// 使生成的文档落在 Electron 的 userData 内（UI 的「在 Finder 中显示」白名单天然命中）。
// 仅当 desktop 负责拉起 backend 子进程时生效；backend 独立启动时由自身 env 配置兜底。
if (!process.env['MODU_DOC_WRITER_ROOT']) {
  process.env['MODU_DOC_WRITER_ROOT'] = join(app.getPath('userData'), 'Documents')
}

// H4: 注入 Content-Security-Policy（CSP），收缩渲染进程可加载/执行的资源来源，
// 即使存在 XSS 也禁止其通过 window.electron.ipcRenderer（已移除）或在内联脚本中
// 放行本地 TS 后端与开发期 HMR 的 ws。
//
// 开发期放宽 script-src：Vite 的 @react-refresh 会在 HTML 内放一段 preamble 脚本，
// 若不加 'unsafe-inline' 会被 CSP 拦截，导致开发环境直接白屏。生产（loadFile）无任何
// 内联脚本，保持严格 'self' 即可。这样在不破坏开发体验的前提下仍满足 H4 的安全目标。
//
// S2 修复：原 connect-src 含 "wss:"（无主机限定），一旦渲染端被 XSS 攻破，攻击者
// 可通过 wss://attacker.com 外泄数据。当前后端未使用 secure WebSocket，直接移除；
// 若未来需要，应限定为具体主机，如 wss://api.example.com。
//
// IPv6 修复：Windows 上 localhost 优先解析到 IPv6 ::1，但 Fastify 默认 host=0.0.0.0
// 仅监听 IPv4，Chromium fetch 优先 IPv6 → 连接被拒。渲染端改用 127.0.0.1 绕开，
// 故 CSP connect-src 必须同时放行 127.0.0.1。
// 通配端口（:*）避免端口变化又要改 CSP；localhost/127.0.0.1 均为本机回环，安全可控。
const RENDERER_CSP = [
  "default-src 'self'",
  `script-src 'self'${is.dev ? " 'unsafe-inline'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [RENDERER_CSP]
      }
    })
  })
}

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
      // H1: preload 已改为 CommonJS（见 electron.vite.config.ts），
      // 故可重开 sandbox:true。沙箱下 preload 仅能访问 contextBridge /
      // ipcRenderer / webUtils 等受限 API，即使渲染进程被 XSS 攻破，
      // 攻击面也远小于 sandbox:false（完整 Node 权限）。
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
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
    // S3 修复：原实现未校验 URL 协议，file:// / javascript: / data: 等危险协议
    // 都会传给 shell.openExternal，可能触发宿主系统的意外行为。
    // 与 SHELL_OPEN_EXTERNAL 处理器一致，仅允许 http(s) 协议。
    if (/^https?:\/\//i.test(details.url)) {
      shell.openExternal(details.url)
    }
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
  // macOS 应用菜单（顶部全局栏第一个菜单）标题由 app.getName() 决定，
  // 在 ready 之前已设置过一次 app.name，这里再次确保（防止被某些初始化覆盖），
  // 并输出到 stderr 便于确认运行时实际生效的名称。
  app.setName('Pioneering')

  // H4: 必须在任何加载/请求前安装 CSP
  installContentSecurityPolicy()

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
