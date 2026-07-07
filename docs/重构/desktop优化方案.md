# apps/desktop 桌面端跨平台（macOS / Windows）适配现状分析与优化方案

> 目标：回答"同一套代码如何在 macOS（全局菜单栏）与 Windows（窗口内标题栏）之间适配"，并给出可落地的优化方案。

---

## 0. 一句话结论

当前 `apps/desktop` **并没有使用 Electron 的原生全局菜单（`Menu.setApplicationMenu`）**，而是采用了用户描述中的**"后者"方案：自己用 HTML 画顶部工具栏**。

即：一个 React 组件 `TitleBar` 同时渲染在 macOS 和 Windows 上，里面包含 `Pioneering / 编辑 / 窗口 / 帮助` 四个下拉菜单、居中的模式切换、右侧的上下文面板开关。两个平台共享同一份 HTML/JSX，差异仅靠**少数几个收口点**做平台分支。这正是"同一套代码跨平台"在**本项目中的真实落地方式**——只是它把菜单放在了"窗口内"而非"系统全局栏"。

这意味着：当前 macOS 上菜单是**画在应用窗口里的**（与 Windows 一致），并没有出现在屏幕顶部的全局菜单栏。这是后续优化的核心目标。

---

## 1. 现状：当前代码是如何用一套模板适配两边的

### 1.1 架构总览

```
main 进程                               renderer 进程（React）
─────────────────────                  ─────────────────────────────────────
window-config.ts                        TitleBar.tsx  ← 一套 HTML 模板
  getWindowOptions(platform)              ├─ 菜单下拉(Pioneering/编辑/窗口/帮助)
  ├─ mac:  frame:true, titleBarStyle      ├─ 模式切换(居中)
  │        'hiddenInset'                   └─ WindowControls(min/max/close)
  └─ win/linux: frame:false             usePlatform.ts
index.ts  createWindow()                 └─ hasNativeWindowControls = isMac
  …autoHideMenuBar:true                  layout-tokens.css  ← CSS 变量按平台
                                          App.tsx → <html data-platform=…>
```

### 1.2 关键的几个"平台分支收口点"

项目把平台差异收敛到了少数明确的位置，组件层几乎不写 `isMac` 判断。

**(1) 窗口 frame 配置 —— 结构性差异的唯一源头**
`src/main/window-config.ts`

```ts
export function getWindowOptions(platform): BrowserWindowConstructorOptions {
  const normalized = normalizePlatform(platform)
  switch (normalized) {
    case 'mac':
      // 保留原生 frame，标题栏用 hiddenInset：
      // 系统自动在红绿灯左侧加 inset 内边距，渲染端不再需要 w-[70px] 魔法数。
      return { frame: true, titleBarStyle: 'hiddenInset' }
    case 'windows':
    case 'linux':
    default:
      // 完全无边框，窗口控件 (min/max/close) 由渲染端 WindowControls 提供。
      return { frame: false, titleBarStyle: undefined }
  }
}
```

- **macOS**：`frame:true + titleBarStyle:'hiddenInset'` → 系统绘制左上角红黄绿交通灯，并自动在交通灯左侧留出内边距；窗口其余的"标题栏"区域交给我们自己的 HTML。
- **Windows/Linux**：`frame:false` → 整个窗口无边框，连 `min/max/close` 都由 HTML 自己画（`WindowControls`）。

`main/index.ts` 在 `createWindow()` 里通过 `...getWindowOptions(process.platform)` 使用它（`src/main/index.ts:19`），同时设置了 `autoHideMenuBar:true`（即不使用任何原生菜单）。

**(2) 是否显示自定义窗口控件**
`src/renderer/src/hooks/usePlatform.ts:17-18`

```ts
// 唯一的结构性差异：macOS 使用原生红绿灯，Win/Linux 由渲染端自绘控件
const hasNativeWindowControls = platform === 'mac'
```

`TitleBar.tsx:131` 据此决定要不要渲染 `WindowControls`：

```ts
const showCustomControls = !hasNativeWindowControls && platform !== 'unknown'
```

**(3) CSS 布局令牌——视觉/尺寸差异全部下沉到变量**
`src/renderer/src/platform/layout-tokens.css`（由 `<html data-platform="…">` 驱动）

```css
:root { --titlebar-h: 40px; --titlebar-leading:0px; --titlebar-trailing:0px; ... }
:root[data-platform='mac']     { --titlebar-h:38px; --titlebar-leading:0px; ... }
:root[data-platform='windows'] { --titlebar-h:40px; --titlebar-leading:8px; ... }
:root[data-platform='linux']   { --titlebar-h:40px; --titlebar-leading:4px; ... }
```

`TitleBar.tsx:167-171` 组件只消费语义变量，不出现 `w-[70px]` 之类的魔法数：

```tsx
style={{
  height: 'var(--titlebar-h)',
  paddingLeft: 'var(--titlebar-leading)',
  paddingRight: 'var(--titlebar-trailing)'
}}
```

**(4) 平台标识的单一数据源**
- 主进程/渲染端共享 `normalizePlatform()`（`src/shared/types.ts:190-195`），把 `darwin/win32/linux` 映射为 `'mac'|'windows'|'linux'|'unknown'`，避免多处各写一份判断。
- `App.tsx:24-47` 启动时经 IPC（`appApi.getPlatform()`）拿到真实平台，写入 `platformAtom` 并写进 `<html data-platform>`；开发预览还支持 `?platform=mac|windows|linux` 覆盖，无需 Electron 环境即可验证样式。

**(5) 其他按平台的微调**
- 响应式断点：`useResponsiveLayout.ts:34` —— mac 在 980px、win/linux 在 1080px 才退化为覆盖抽屉布局（无边框窗口需要更宽才切）。
- 原生字体：`index.css:167-178` —— mac 用 SF Pro，Windows 用 Segoe UI。
- 窗口拖拽：`TitleBar.tsx` + `main/ipc-handlers.ts` 用**纯 IPC**（`window:drag-start/move/end`）实现拖拽，绕开 `-webkit-app-region` 会拦截按钮点击的已知 bug（无边框窗口必备）。

### 1.3 现有设计的优点（应保留）

- ✅ 平台差异集中在 `window-config.ts`、`usePlatform.ts`、`layout-tokens.css` 三处，组件层零硬编码。
- ✅ CSS 变量化，新增平台只改配置表 + 一个 CSS 块。
- ✅ `?platform=` 预览覆盖，前后端分离调试方便。
- ✅ IPC 拖拽比 `-webkit-app-region` 稳健。
- ✅ 单一数据源 `normalizePlatform` / `platformAtom`。

---

## 2. 当前方案存在的问题（优化动机）

### 问题 1（核心）：macOS 菜单没有进入屏幕顶部全局栏
macOS 规范要求菜单出现在**屏幕顶部的全局栏**（含 苹果菜单 + App 菜单 + File/Edit/...）。当前 `TitleBar` 把 `Pioneering/编辑/窗口/帮助` 画在**窗口内部**，macOS 用户会感觉"菜单既不在全局栏、又在窗口里"，与系统习惯不符，也浪费了 macOS 全局栏的肌肉记忆（如 `⌘Q` 退出、`⌘H` 隐藏）。
> 这正是用户描述中的关键差异点：当前只实现了"窗口内 HTML 工具栏"这一种，没有利用"全局栏"那条路径。

### 问题 2：菜单模板没有"数据化"，双端易产生两份定义
`TitleBar.tsx` 的菜单项是**手写的 JSX + 内联处理函数**（`handleAbout/handleQuit/handleOpenDocs...`，`TitleBar.tsx:99-125`、下拉结构 `174-276`）。若要在 macOS 上补一套原生全局菜单，就会再写一份 `Menu.buildFromTemplate`，两份定义极易漂移（菜单项/快捷键对不上）。

### 问题 3：快捷键图标硬编码为 ⌘，Windows 下显示错误
`TitleBar.tsx:207-244` 等处的 `DropdownMenuShortcut` 直接写死：

```
⌘Z / ⇧⌘Z / ⌘X / ⌘C / ⌘V / ⌘A / ⌘W / ⌘⇧I
```

在 Windows 上应显示 `Ctrl+Z` 等。当前所有平台都显示 ⌘，与 Windows 用户认知不符。

### 问题 4：编辑菜单用已废弃的 `document.execCommand`
`TitleBar.tsx:126-128` 的 `execEdit` 使用 `document.execCommand`（`undo/redo/cut/copy/paste/selectAll`），该 API 已废弃。

### 问题 5：macOS 全屏态下标题栏未自适应
`RootLayout/TitleBar` 有 `isFullscreenAtom` 订阅能力，但 `TitleBar` 未在全屏时调整（macOS 全屏后原生不再占用交通灯区域，`--titlebar-leading` 留白逻辑可简化）。属细节，但体验上应处理。

---

## 3. 优化目标架构（"同一套模板跨平台"的标准做法）

把用户描述里的标准模式落到本项目，并复用现有优点：

```
                ┌──────────────────────────────┐
                │  共享菜单模板 (数据)            │  src/shared/menu-template.ts
                │  Pioneering/编辑/窗口/帮助 +动作id │
                └──────────────┬───────────────┘
                               │ 同一份数据
            ┌──────────────────┴───────────────────┐
            ▼                                       ▼
   macOS: main 进程                          Windows: renderer 进程
   Menu.setApplicationMenu(template)         TitleBar 从模板渲染 HTML 下拉
   → 屏幕顶部全局栏（窗口外）                  → 窗口内 HTML 工具栏
   渲染端 mac 上：隐藏窗口内菜单 dropdowns      渲染端 win 上：保留窗口内下拉
   （只留交通灯 + 拖拽区 + 模式 + 上下文开关）     （含 WindowControls）
```

收口点仍保持"极少分支"：
- `window-config.ts`：frame 配置（结构差异，已存在）。
- `src/main/index.ts`：仅一行 `if (process.platform === 'darwin') Menu.setApplicationMenu(...)`（新增，对应描述里的"一行平台分支"）。
- `usePlatform().isMac`：控制"窗口内是否还画菜单下拉"（新增一处消费）。
- `layout-tokens.css`：视觉差异（已存在）。

---

## 4. 详细改造方案

### 4.1 菜单模板数据化（单一数据源）

新增 `src/shared/menu-template.ts`，用纯数据描述菜单，**不绑定任何进程相关代码**，动作用 `id` 引用（渲染端/主进程各自把 `id` 映射到真实处理函数）：

```ts
// src/shared/menu-template.ts
export type MenuActionId =
  | 'about' | 'checkUpdate' | 'quit'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'closeWindow'
  | 'openDocs' | 'networkCheck' | 'openLogDir' | 'feedback' | 'devTools'

export interface MenuTemplateItem {
  id?: MenuActionId
  label: string
  // Electron 原生 accelerator 格式，主进程直接用；渲染端用 4.4 的格式化器转译
  accelerator?: string
  separator?: boolean
  submenu?: MenuTemplateItem[]
  // 仅在特定平台出现（如 macOS 的 appMenu / windowMenu）
  platform?: 'mac' | 'windows' | 'linux'
}

export const menuTemplate: MenuTemplateItem[] = [
  {
    label: 'Pioneering',
    platform: 'mac', // 仅 macOS 走原生 App 菜单；Windows 由 HTML 提供同名入口
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
    submenu: [
      { id: 'closeWindow', label: '关闭窗口', accelerator: 'CmdOrCtrl+W' }
    ]
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
```

### 4.2 渲染端消费模板（HTML TitleBar 改为数据驱动）

新增 `src/renderer/src/menu/menuActions.ts`，把 `MenuActionId` 映射到渲染端处理函数（替换当前 `TitleBar.tsx` 里散落的 `handleAbout/handleQuit/...`）：

```ts
// src/renderer/src/menu/menuActions.ts
import { setSettingsOpenAtom } from '@/stores/atoms'
import { appApi, windowApi, shellApi } from '@/services/ipc'
import { useSetAtom } from 'jotai'

// 在组件外用 atom setter 直接派发；也可在 TitleBar 内通过 hook 调用
export function runMenuAction(id: MenuActionId) {
  switch (id) {
    case 'about':        setSettingsOpenAtom && openSettings(); break
    case 'checkUpdate':  void appApi.checkUpdate(); break
    case 'quit':         void appApi.quit(); break
    case 'undo':         execEdit('undo'); break
    // ... cut/copy/paste/selectAll/closeWindow/openDocs/...
    case 'devTools':     void windowApi.toggleDevTools(); break
  }
}
```

`TitleBar.tsx` 改为"遍历 `menuTemplate` 渲染下拉"，并**在 macOS 上隐藏整组菜单下拉**（因为已挂到全局栏）：

```tsx
const { isMac } = usePlatform()
// ...
{!isMac && menuTemplate
  .filter(m => !m.platform || m.platform !== 'mac') // Windows 也渲染 Pioneering 入口
  .map(menu => <MenuDropdown key={menu.label} item={menu} />)}
```

`MenuDropdown` 用 `formatAccelerator(item.accelerator, platform)`（见 4.4）渲染快捷键。这样：
- Windows/Linux：窗口内 HTML 菜单不变，但内容来自模板、快捷键自动本地化。
- macOS：窗口内不再画菜单下拉，只保留交通灯 + 拖拽区 + 模式切换 + 上下文开关（菜单在全局栏）。

### 4.3 主进程消费模板（macOS 全局菜单）

新增 `src/main/menu.ts`：

```ts
// src/main/menu.ts
import { Menu, BrowserWindow, app, shell } from 'electron'
import { menuTemplate, MenuActionId } from '../shared/menu-template'
import { IpcChannel } from '../shared/ipc-channels'

// 把渲染端动作改为主进程可直接执行的逻辑；需要渲染端配合的用 webContents.send
function runAction(id: MenuActionId, win: BrowserWindow | null) {
  switch (id) {
    case 'about':       win?.webContents.send(IpcChannel.MENU_ACTION, 'about'); break
    case 'quit':        app.quit(); break
    case 'devTools':    win?.webContents.toggleDevTools(); break
    case 'openDocs':    shell.openExternal('https://docs.pioneering.ai'); break
    case 'feedback':    shell.openExternal('https://github.com/pioneering/feedback'); break
    // cut/copy/paste 等编辑动作在原生 editMenu 中由 Electron 自动处理，无需手写
  }
}

export function buildAppMenu(win: BrowserWindow | null): Menu {
  const template = menuTemplate
    .filter(t => !t.platform || t.platform === 'mac')
    .map(t => ({
      label: t.label,
      submenu: t.submenu?.map(s => ({
        label: s.label,
        accelerator: s.accelerator,
        click: () => runAction(s.id!, win)
      }))
    }))
  return Menu.buildFromTemplate(template as any)
}
```

在 `src/main/index.ts` 仅一行平台分支挂上全局栏：

```ts
import { buildAppMenu } from './menu'
// ...
createWindow()
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(buildAppMenu(mainWindow)) // → 屏幕顶部全局栏（窗口外）
}
```

> 注：菜单里的 `撤销/重做/剪切/复制/粘贴/全选` 在原生菜单中 Electron 会自动绑定到页面编辑行为，无需像 HTML 版那样调 `document.execCommand`，顺带解决了问题 4。

可新增一个 IPC 通道 `MENU_ACTION`，渲染端监听后打开设置弹框等（复用 `platformAtom` 已有的初始化路径）。

### 4.4 快捷键格式化器（修复问题 3）

新增 `src/renderer/src/menu/formatAccelerator.ts`，把模板里的 `CmdOrCtrl+Z` / `Shift+CmdOrCtrl+Z` 转成当前平台的显示串：

```ts
// mac -> ⌘Z / ⇧⌘Z；win/linux -> Ctrl+Z / Ctrl+Shift+Z
export function formatAccelerator(accel: string | undefined, platform: Platform): string {
  if (!accel) return ''
  const isMac = platform === 'mac'
  const mod = isMac ? '⌘' : 'Ctrl+'
  const shift = accel.includes('Shift') ? (isMac ? '⇧' : 'Shift+') : ''
  const key = accel.split('+').pop()!.toUpperCase()
  return isMac ? `${shift}${mod}${key}` : `${mod}${shift}${key}`
}
```

这样同一份模板在两端显示正确图标，且日后统一改模板即可。

### 4.5 平台分流收口（一处 `isMac` 控制）

将"是否在窗口内画菜单"统一收口到 `usePlatform.ts`：

```ts
// usePlatform.ts
const showInWindowMenu = platform !== 'mac'   // mac 走全局栏，窗口内不画
return { isMac, isWindows, isLinux, showInWindowMenu, hasNativeWindowControls, platform, ... }
```

`TitleBar` 只依赖 `showInWindowMenu`，避免散落的 `!isMac` 判断。

### 4.6 全屏态适配（修复问题 5）

`TitleBar.tsx` 订阅 `isFullscreenAtom`；macOS 全屏时：交通灯由系统接管，HTML 标题栏可隐藏菜单留白或整体降级为只含模式切换的极简条：

```tsx
const { isFullscreen } = usePlatform()
// 全屏时 macOS 不再需要左侧交通灯占位，但本应用标题栏仍承担拖拽/模式切换，保留即可
```

（此项为体验增强，优先级低于 4.1–4.4。）

---

## 5. 改造前后对比

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| macOS 菜单位置 | 窗口内 HTML 下拉 | 屏幕顶部全局栏（`setApplicationMenu`） |
| Windows 菜单位置 | 窗口内 HTML 下拉 | 窗口内 HTML 下拉（内容来自同一模板） |
| 菜单定义 | `TitleBar.tsx` 手写 JSX + 内联函数 | `shared/menu-template.ts` 单一数据源，两端消费 |
| 快捷键显示 | 写死 `⌘`（Windows 错） | `formatAccelerator` 按平台显示 ⌘/Ctrl |
| 编辑动作 | `document.execCommand`（废弃） | 原生菜单自动处理 + 渲染端动作映射 |
| 平台分支数 | frame 配置 + hasNativeWindowControls | +1 行 `setApplicationMenu` 分支（与用户描述一致） |
| 新增平台成本 | 改 window-config + CSS 块 | 同上，并补模板的 `platform` 过滤 |

---

## 6. 实施步骤与风险

**步骤**
1. 新增 `src/shared/menu-template.ts`（数据 + 类型）。
2. 新增 `src/renderer/src/menu/menuActions.ts` 与 `formatAccelerator.ts`，改写 `TitleBar.tsx` 由模板渲染；`usePlatform.ts` 增加 `showInWindowMenu`。
3. 新增 `src/main/menu.ts`，在 `index.ts` 加 `if(darwin) Menu.setApplicationMenu`。
4. 新增 `MENU_ACTION` IPC（设置弹框等需渲染端配合的动作）。
5. 验证：`?platform=windows` 看窗口内菜单正常且快捷键为 Ctrl；macOS 打包验证全局栏 + 窗口内只留交通灯/模式/上下文。

**风险与注意**
- macOS 原生菜单的 `关于`/`设置` 需要渲染端配合（经 `MENU_ACTION` 打开 React 设置弹框），注意渲染进程就绪时机（窗口 `ready-to-show` 后菜单才可用，可接受）。
- `app.quit()`、外部链接等可在主进程直接处理，无需 IPC，减少耦合。
- 保持现有 `?platform=` 预览覆盖，便于无 macOS 机器时验证全局栏以外的 UI。
- `autoHideMenuBar:true` 在 macOS 走 `setApplicationMenu` 后应移除/忽略（mac 下该选项无意义）。

---

## 7. 总结

当前项目已经把"窗口 frame / 窗口控件 / 视觉令牌 / 字体 / 断点"等差异很好地收敛到 `window-config.ts`、`usePlatform.ts`、`layout-tokens.css` 几处，组件层几乎无平台硬编码——这是优秀的跨平台基础。但它采用的是"全程 HTML 工具栏"的方案，导致 **macOS 菜单没有进入系统全局栏**、**快捷键图标写死 ⌘**。

优化方向是把菜单本身**数据化成一个共享模板**，再用"仅一行平台分支"决定模板挂到 macOS 全局栏（`Menu.setApplicationMenu`）还是渲染成 Windows 窗口内 HTML 工具栏。这样既贴合两个 OS 的原生规范，又延续了项目"差异集中收口、组件层零硬编码"的设计哲学。
