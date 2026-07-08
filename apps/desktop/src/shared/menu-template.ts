// ============================================================
// Menu Template — 跨平台菜单单一数据源
// 用纯数据描述菜单，不绑定任何进程相关代码；
// 动作用 MenuActionId 引用，主进程/渲染端各自把 id 映射到真实处理逻辑。
// macOS：main 进程用 Menu.setApplicationMenu 渲染到屏幕顶部全局栏；
// Windows/Linux：渲染端用本模板渲染窗口内 HTML 下拉。
// ============================================================

export type MenuActionId =
  | 'about'
  | 'checkUpdate'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'closeWindow'
  | 'openDocs'
  | 'networkCheck'
  | 'openLogDir'
  | 'feedback'
  | 'devTools'

export interface MenuTemplateItem {
  id?: MenuActionId
  label?: string
  // Electron 原生 accelerator 格式（CmdOrCtrl/Shift/CmdOrCtrl），主进程直接用；
  // 渲染端用 formatAccelerator 转成当前平台显示串。
  accelerator?: string
  separator?: boolean
  submenu?: MenuTemplateItem[]
  // 仅在特定平台出现（如 macOS 的 App 菜单）。
  platform?: 'mac' | 'windows' | 'linux'
}

export const menuTemplate: MenuTemplateItem[] = [
  {
    label: 'Pioneering',
    platform: 'mac', // 仅 macOS 走原生 App 菜单；Windows/Linux 由 HTML 提供同名入口
    submenu: [
      { id: 'about', label: '关于 Pioneering' },
      { id: 'checkUpdate', label: '检查更新' },
      { separator: true },
      { id: 'quit', label: '退出 Pioneering', accelerator: 'CmdOrCtrl+Q' }
    ]
  },
  {
    label: '编辑',
    submenu: [
      { id: 'undo', label: '撤销', accelerator: 'CmdOrCtrl+Z' },
      { id: 'redo', label: '重做', accelerator: 'Shift+CmdOrCtrl+Z' },
      { separator: true },
      { id: 'cut', label: '剪切', accelerator: 'CmdOrCtrl+X' },
      { id: 'copy', label: '复制', accelerator: 'CmdOrCtrl+C' },
      { id: 'paste', label: '粘贴', accelerator: 'CmdOrCtrl+V' },
      { separator: true },
      { id: 'selectAll', label: '全选', accelerator: 'CmdOrCtrl+A' }
    ]
  },
  {
    label: '窗口',
    submenu: [{ id: 'closeWindow', label: '关闭窗口', accelerator: 'CmdOrCtrl+W' }]
  },
  {
    label: '帮助',
    submenu: [
      { id: 'openDocs', label: '使用文档' },
      { id: 'networkCheck', label: '网络检查' },
      { id: 'openLogDir', label: '打开日志目录' },
      { id: 'feedback', label: '意见反馈' },
      { separator: true },
      { id: 'devTools', label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I' }
    ]
  }
]
