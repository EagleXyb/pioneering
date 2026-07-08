# InputArea 输入区域实现分析

> 基于 OpenCowork 源码深度阅读，覆盖输入区域的所有核心模块。

---

## 目录

1. [整体架构](#1-整体架构)
2. [InputArea 主组件](#2-inputarea-主组件)
3. [FileAwareEditor 富文本编辑器](#3-fileawareeditor-富文本编辑器)
4. [select-file-editor 文档模型](#4-select-file-editor-文档模型)
5. [select-file-tags 标签系统](#5-select-file-tags-标签系统)
6. [图片附件系统](#6-图片附件系统)
7. [拖拽与粘贴处理](#7-拖拽与粘贴处理)
8. [SkillsMenu 技能菜单](#8-skillsmenu-技能菜单)
9. [ModelSwitcher 模型选择器](#9-modelswitcher-模型选择器)
10. [Slash 命令与文件搜索弹出层](#10-slash-命令与文件搜索弹出层)
11. [输入草稿持久化](#11-输入草稿持久化)
12. [Prompt 推荐系统](#12-prompt-推荐系统)
13. [Token 计数器](#13-token-计数器)
14. [上下文压缩](#14-上下文压缩)
15. [消息队列系统](#15-消息队列系统)
16. [数据流总结](#16-数据流总结)

---

## 1. 整体架构

输入区域由以下层级组成，自底向上：

```
┌──────────────────────────────────────────────────────────────┐
│  SessionConversationPane.tsx  (容器层，组装输入区域)           │
├──────────────────────────────────────────────────────────────┤
│  InputArea.tsx  (核心输入区域，约 4600 行)                    │
│  ├── FileAwareEditor.tsx  (富文本编辑器)                      │
│  ├── SkillsMenu.tsx  (技能/命令/插件菜单)                     │
│  ├── ModelSwitcher.tsx  (模型选择器弹出面板)                   │
│  ├── ContextRing.tsx  (上下文压缩环)                          │
│  ├── ComposerRuntimeStatus.tsx  (运行时状态展示)               │
│  └── GoalSessionBar.tsx  (目标会话栏)                         │
├──────────────────────────────────────────────────────────────┤
│  lib/ 层 (数据模型与工具函数)                                  │
│  ├── select-file-editor.ts  (EditorDocumentNode 文档模型)     │
│  ├── select-file-tags.ts  (文件/插件标签序列化)               │
│  ├── image-attachments.ts  (图片附件处理)                     │
│  ├── input-drafts.ts  (草稿持久化, IPC 通信)                  │
│  └── drag-folder.ts  (拖拽路径解析)                           │
├──────────────────────────────────────────────────────────────┤
│  hooks/ 层 (React Hooks)                                      │
│  ├── use-input-draft-persistence.ts  (草稿持久化 Hook)        │
│  ├── use-prompt-recommendation.ts  (Prompt 推荐 Hook)         │
│  └── use-estimated-tokens.ts  (Token 估算 Hook)               │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. InputArea 主组件

### 2.1 文件位置

[InputArea.tsx](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/components/chat/InputArea.tsx)

### 2.2 Props 接口

```typescript
interface InputAreaProps {
  sessionId?: string | null              // 关联的会话 ID
  onSend: (text, images?, options?) => void  // 发送消息回调
  onStop?: () => void                    // 停止流式输出
  onSelectFolder?: () => void            // 选择工作目录
  isStreaming?: boolean                  // 是否正在流式输出
  workingFolder?: string                 // 当前工作目录
  hideWorkingFolderIndicator?: boolean   // 隐藏工作目录指示器
  hideWorkingFolderPicker?: boolean      // 隐藏工作目录选择按钮
  onCompressContext?: () => ...          // 上下文压缩回调
  disabled?: boolean                     // 是否禁用
  draftKeyOverride?: string | null       // 草稿键覆盖
  suppressPendingQueue?: boolean         // 是否抑制消息队列
  hideGoalSessionBar?: boolean           // 隐藏目标会话栏
  hideModeSwitch?: boolean               // 隐藏模式切换
  modelRoute?: 'main' | 'fast'          // 模型路由
  readOnlyModel?: MessageRequestModelMeta | null  // 只读模型
  attachedFooter?: boolean               // 是否吸附在底部
  fullWidth?: boolean                    // 是否全宽
}
```

### 2.3 核心状态

| 状态 | 类型 | 用途 |
|------|------|------|
| `documentNodes` | `EditorDocumentNode[]` | 编辑器文档模型，包含文本节点/文件引用节点/插件节点 |
| `selectedFiles` | `SelectedFileItem[]` | 已选中的文件引用列表 |
| `attachedImages` | `ImageAttachment[]` | 已附带的图片附件（base64 dataUrl） |
| `selectedSkill` | `string \| null` | 当前选中的 Skill 名称 |
| `editorSelection` | `{ start, end }` | 编辑器光标/选区 |
| `text` | `string` | 纯文本（由 documentNodes 计算得出） |
| `finalSerializedText` | `string` | 序列化文本（含标签标记） |
| `inputHeight` | `number \| null` | 手动调整的输入框高度（null = 自动） |
| `autoInputHeight` | `number` | 自动计算的输入框高度 |
| `highlightedFileId` | `string \| null` | 高亮显示的文件引用 ID |
| `pendingImageReads` | `number` | 正在读取的图片数量 |
| `isOptimizing` | `boolean` | 是否正在优化 Prompt |
| `contextCompressionStatus` | `ContextCompressionStatus` | 上下文压缩状态 |

### 2.4 输入框高度管理

输入框高度支持两种模式：

1. **固定高度模式**（`inputHeight !== null`）：用户手动拖拽调整高度
2. **自动高度模式**（`inputHeight === null`）：根据内容自动扩展

**拖拽调整**：通过 `handleDragStart` 鼠标事件，在 `mousemove` 中动态计算高度，支持 `getMinInputHeight()` 和 `getMaxInputHeight()` 边界约束。

**自动高度**：通过 `ResizeObserver` 监听容器尺寸变化，调用 `syncAutoInputHeight()` 计算 `chromeHeight + editor.scrollHeight` 的最小值。

### 2.5 发送流程

```typescript
const handleSend = useCallback((): void => {
  // 1. 获取实时编辑器状态
  const liveEditorState = getLiveEditorState()
  const promptText = liveEditorState.promptText.trim()

  // 2. 验证：需要文本或图片
  if (!promptText && attachedImages.length === 0) return

  // 3. 构建消息前缀
  const message = selectedSkill && !hasLeadingSlashCommand
    ? `[Skill: ${selectedSkill}]\n${promptText}`
    : promptText

  // 4. 构建发送选项
  const sendOptions: SendMessageOptions = {
    clearCompletedTasksOnTurnStart: true,
    enablePlanMode: planMode || undefined,
    selectedFileReferences: ...,  // 文件引用
    goalObjective: ...            // 目标模式
  }

  // 5. 调用 onSend 回调
  onSend(message, attachedImages, sendOptions)

  // 6. 重置编辑器
  resetComposer()
}, [...])
```

### 2.6 键盘快捷键

通过 `handleKeyDown` 统一处理：

| 按键 | 作用 |
|------|------|
| `Enter` (无 Shift) | 发送消息 |
| `Shift+Enter` | 换行（由编辑器控制） |
| `Tab` | 接受 Prompt 推荐 |
| `ArrowDown/Up` (文件菜单) | 切换文件搜索结果 |
| `ArrowDown/Up` (Slash 菜单) | 切换 Slash 建议 |
| `Tab/Enter` (文件菜单) | 插入选中的文件引用 |
| `Tab/Enter` (Slash 菜单) | 应用选中的 Slash 建议 |
| `Escape` (文件菜单) | 关闭文件菜单，回到输入 |

### 2.7 粘贴处理

```typescript
const handlePaste = useCallback((e) => {
  // 1. 检查是否有图片粘贴
  const imageFiles = getPastedImageFiles(e.clipboardData)
  if (imageFiles.length > 0) {
    e.preventDefault()
    void addImages(imageFiles)
    return
  }

  // 2. 否则作为纯文本粘贴
  const plainText = e.clipboardData.getData('text/plain')
  if (!plainText) return
  e.preventDefault()
  replaceSelectionWithText(plainText, selection)
}, [...])
```

---

## 3. FileAwareEditor 富文本编辑器

### 3.1 文件位置

[FileAwareEditor.tsx](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/components/chat/FileAwareEditor.tsx)

### 3.2 核心功能

FileAwareEditor 是一个基于 `contentEditable` 的富文本编辑器，提供了以下能力：

- **文本编辑**：标准的输入、删除、选择、光标移动
- **文件引用 Chip**：通过 `data-file-ref` 属性内联渲染文件引用，显示为可交互的 Chip（徽章）
- **插件引用**：通过 `data-plugin-ref` 属性渲染插件引用
- **Suggestion（Prompt 推荐）**：在光标后显示灰色提示文本，Tab 键接受
- **选区管理**：`getSelectionOffsets()` / `setSelectionOffsets()` 管理光标位置（基于纯文本偏移量）
- **文档快照**：`getDocumentSnapshot()` 获取实时文档模型

### 3.3 与 select-file-editor 的协同

FileAwareEditor 通过 `onDocumentChange` 回调将编辑器的内容变化同步到 InputArea 的 `documentNodes` 状态。当用户删除文件引用 Chip 时，自动触发 `onReferenceDelete` 回调。

### 3.4 暴露的 Ref 方法

```typescript
interface FileAwareEditorHandle {
  focus(): void
  focusAtEnd(): void
  getSelectionOffsets(): { start: number; end: number }
  setSelectionOffsets(start: number, end: number): void
  getScrollMetrics(): { clientHeight: number; scrollHeight: number }
  getDocumentSnapshot(): EditorDocumentNode[]
  scrollToReference(fileId: string): void
}
```

---

## 4. select-file-editor 文档模型

### 4.1 文件位置

[select-file-editor.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/lib/select-file-editor.ts)

### 4.2 文档节点类型

```typescript
type EditorDocumentNode = EditorTextNode | EditorFileNode | EditorPluginNode | EditorReplacementNode

interface EditorTextNode {
  type: 'text'
  id: string
  text: string
}

interface EditorFileNode {
  type: 'file'
  id: string
  fileId: string
  fallbackText: string      // 当文件不存在时的回退文本
}

interface EditorPluginNode {
  type: 'plugin'
  id: string
  pluginId: string
  label: string
  prompt: string            // 插件展开后的完整 prompt
}

interface EditorReplacementNode {
  type: 'replacement'
  id: string
  label: string
  pluginId: string
}
```

### 4.3 核心函数

| 函数 | 用途 |
|------|------|
| `createTextNode(text)` | 创建文本节点 |
| `createFileNode(fileId, fallbackText)` | 创建文件引用节点 |
| `createPluginNode(pluginId, label, prompt)` | 创建插件引用节点 |
| `editorDocumentToPlainText(document, files)` | 将文档转为纯文本（用于 Token 计算、光标定位） |
| `serializeEditorDocument(document, files, options?)` | 序列化为带标签的文本（`<select-file>`/`<select-plugin>`） |
| `deserializeEditorState(text, workingFolder, baseFiles)` | 反序列化，将带标签文本解析为文档模型 + 文件列表 |
| `addFilesToSelection(currentFiles, filePaths, workingFolder?)` | 添加文件到选中列表 |
| `ensureSelectedFile(currentFiles, filePath, workingFolder?)` | 确保文件被选中（去重） |
| `removeSelectedFile(currentFiles, document, fileId)` | 移除文件引用 |
| `removeReferenceNode(document, nodeId, files)` | 移除引用节点（文件/插件） |
| `replaceEditorRange(document, files, start, end, replacement)` | 替换文档中的指定范围 |
| `normalizeSelectionToFileBoundaries(document, files, start, end)` | 将选区对齐到文件引用边界 |
| `documentHasFileReferences(document, fileId?)` | 检查文档是否包含文件引用 |

### 4.4 序列化示例

```
用户输入: "检查这个文件"
文件引用: <select-file>src/index.ts</select-file>
插件引用: <select-plugin>{"pluginId":"explain","label":"Explain","prompt":"explain the code"}</select-plugin>
```

序列化后的文本：
```
检查这个文件<select-file>src/index.ts</select-file>
<select-plugin>{"pluginId":"explain","label":"Explain","prompt":"explain the code"}</select-plugin>
```

`serializeEditorDocument` 支持 `expandPluginPrompts` 选项，当为 `true` 时，插件节点会展开为完整的 prompt 文本（发送给 LLM 时使用）。

### 4.5 文件合并策略

`mergeSelectedFiles()` 按文件路径去重，优先保留已有文件的完整元数据。当从不同目录添加同名文件时，通过 `buildFileKey()` 和 `normalizePathKey()` 双重校验。

---

## 5. select-file-tags 标签系统

### 5.1 文件位置

[select-file-tags.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/lib/select-file-tags.ts)

### 5.2 三种标签语法

| 语法 | 格式 | 示例 |
|------|------|------|
| XML 标签 | `<select-file>...</select-file>` | `<select-file>src/index.ts</select-file>` |
| 内联 Token | `@{...}` | `@{src/index.ts}` |
| 插件标签 | `<select-plugin>...</select-plugin>` | `<select-plugin>{"pluginId":"explain","label":"Explain","prompt":"explain"}</select-plugin>` |

### 5.3 核心函数

| 函数 | 用途 |
|------|------|
| `createSelectFileTag(filePath)` | 创建 XML 格式文件引用标签 |
| `createSelectFileToken(filePath)` | 创建 `@{}` 格式文件引用标签 |
| `createSelectPluginTag(payload)` | 创建插件引用标签 |
| `parseSelectFileText(text)` | 解析文本，提取所有标签，返回 `SelectFileTextSegment[]` |
| `findSelectFileTagAt(text, cursor)` | 查找光标位置所在的标签 |
| `getSelectFileMentionQuery(text, cursor)` | 获取 `@` 触发的文件搜索查询 |
| `selectFileTextToPlainText(text)` | 移除标签，只保留纯文本 |
| `normalizeSelectFileText(text)` | 标准化标签格式（统一转为 `@{}` 格式） |
| `serializeSelectFileText(text)` | 序列化标签（统一转为 `<select-file>` 格式） |
| `hasSelectFileTag(text)` | 检查文本是否包含文件引用标签 |

### 5.4 `@` 文件搜索触发

`getSelectFileMentionQuery()` 算法：

```
从光标位置向左搜索，遇到空白字符停止
  如果遇到 '}' 或 '<' 或 '>'，返回 null（已在标签内）
  如果遇到 '@'：
    检查后面是否跟着 '{'（是则返回 null，已在 @{} 内）
    检查前面字符是否是字母/数字/下划线/点/斜杠（是则返回 null，不是单独 @）
    返回 { start, end, query } 表示一次有效的文件搜索触发
```

---

## 6. 图片附件系统

### 6.1 文件位置

[image-attachments.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/lib/image-attachments.ts)

### 6.2 核心类型

```typescript
interface ImageAttachment {
  id: string          // 唯一标识（nanoid）
  dataUrl: string     // base64 data URL 或 HTTP URL
  mediaType: string   // MIME 类型
}

interface EditableUserMessageDraft {
  text: string
  images: ImageAttachment[]
  command: SystemCommandSnapshot | null
}
```

### 6.3 常量与限制

```typescript
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024  // 20 MB
const QUEUED_IMAGE_ONLY_TEXT = '[User attached images without additional text.]'
```

### 6.4 核心函数

| 函数 | 用途 |
|------|------|
| `fileToImageAttachment(file)` | 将 File 对象通过 FileReader 读取为 base64 ImageAttachment（异步） |
| `imageAttachmentToContentBlock(attachment)` | 将 ImageAttachment 转为 API 的 ContentBlock 格式 |
| `imageBlockToAttachment(imageBlock)` | 将 API 的 ImageBlock 转为 ImageAttachment |
| `extractEditableText(content)` | 从消息内容中提取可编辑文本（移除系统命令标签和系统提醒） |
| `extractEditableImages(content)` | 从消息内容中提取图片附件 |
| `extractEditableUserMessageDraft(content)` | 完整提取可编辑消息草稿（文本+图片+命令） |
| `cloneImageAttachments(images)` | 深拷贝图片附件列表 |
| `areImageAttachmentsEqual(left, right)` | 比较两个图片附件列表是否相等 |

### 6.5 图片预览

InputArea 中的图片附件区域显示为缩略图条（`composer-image-thumb`），支持：
- 点击放大预览（`Dialog` 组件，全屏/大窗口）
- 悬停显示删除按钮
- 仅支持 Vision 模型时显示图片粘贴功能

---

## 7. 拖拽与粘贴处理

### 7.1 文件位置

[drag-folder.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/lib/drag-folder.ts)

### 7.2 拖拽路径解析

```typescript
export function getDroppedLocalPaths(dataTransfer): string[] {
  // Electron 36 移除了 File.path 属性
  // 通过 preload 暴露的 webUtils.getPathForFile 获取路径
  const getPathForFile = window.electron?.webUtils?.getPathForFile
  if (!dataTransfer || typeof getPathForFile !== 'function') return []

  const paths: string[] = []
  for (const file of Array.from(dataTransfer.files)) {
    const resolved = getPathForFile(file)
    if (resolved) paths.push(resolved)
  }
  return paths
}
```

### 7.3 内部拖拽 MIME 类型

```typescript
const INTERNAL_FILE_DRAG_MIME = 'application/x-opencowork-file-refs'  // 约行号 3360
```

### 7.4 InputArea 中的拖拽处理

| 事件处理 | 作用 |
|----------|------|
| `handleDragOver` | 检查 dataTransfer 是否包含 Files 或内部 MIME 类型，设置 `dropEffect = 'copy'` |
| `handleDragLeave` | 检查 `relatedTarget` 是否仍在容器内，避免闪烁 |
| `handleDropWrapped` | 优先处理内部拖拽（`getDraggedFilePaths`），然后处理原生文件拖拽（`handleDropFiles`） |
| `handleDropFiles` | 调用 `getDroppedLocalPaths` 获取路径，调用 `addFilesToEditor` 插入编辑器中 |

### 7.5 粘贴图片流程

1. 检查当前模型是否支持 Vision（`supportsVision`）
2. 从 `clipboardData.items` 中筛选 `ACCEPTED_IMAGE_TYPES` 的图片文件
3. 调用 `fileToImageAttachment()` 异步读取为 base64 ImageAttachment
4. 添加到 `attachedImages` 状态
5. 预览区显示缩略图

---

## 8. SkillsMenu 技能菜单

### 8.1 文件位置

[SkillsMenu.tsx](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/components/chat/SkillsMenu.tsx)

### 8.2 结构

```typescript
<DropdownMenu>
  <DropdownMenuTrigger>          ← "+" 按钮
    <Plus className="size-4" />
  </DropdownMenuTrigger>
  <SkillsMenuContent>            ← 弹出内容
    ├── Select Skill 分组        ← 从 skills-store 加载的已安装技能
    ├── Search Web 开关          ← Web 搜索切换
    ├── Plan Mode 开关           ← 计划模式
    ├── Goal Mode 开关           ← 目标模式
    ├── Command 列表             ← 从 command-loader 加载的系统命令
    ├── Plugin 列表              ← 从 app-plugin-store 加载的应用插件
    ├── Channel 列表             ← 消息通道（Feishu/DingTalk/Discord 等）
    ├── MCP 工具列表             ← 从 mcp-store 加载的 MCP 工具
    └── Extension 工具列表       ← 从 extension-store 加载的扩展工具
  </SkillsMenuContent>
</DropdownMenu>
```

### 8.3 Props

```typescript
interface SkillsMenuProps {
  onSelectSkill: (name: string) => void
  onSelectCommand?: (name: string) => void
  onSelectPlugin?: (pluginId: AppPluginId) => void
  onAttachMedia?: () => void
  disabled?: boolean
  projectId?: string | null
  showChannels?: boolean
  showModeToggles?: boolean
  planModeEnabled?: boolean
  goalModeEnabled?: boolean
  planModeDisabled?: boolean
  goalModeDisabled?: boolean
  onPlanModeChange?: (enabled: boolean) => void
  onGoalModeChange?: (enabled: boolean) => void
}
```

### 8.4 交互流程

1. 用户点击 "+" 按钮，打开 DropdownMenu
2. 加载技能列表、命令列表、插件列表
3. 用户选择技能/命令/插件 → 调用对应回调
4. 选择技能时，设置 `selectedSkill` 状态，清空编辑器
5. 选择命令时，通过 `insertSlashCommand` 插入 `/<command>` 文本
6. 选择插件时，通过 `insertPluginPrompt` 插入 `<select-plugin>` 标签

---

## 9. ModelSwitcher 模型选择器

### 9.1 文件位置

[ModelSwitcher.tsx](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/components/chat/ModelSwitcher.tsx)

### 9.2 核心功能

ModelSwitcher 是一个弹出式面板，用于选择 AI 模型及其配置：

- **模型选择模式**：Auto（自动选择）/ Manual（手动选择）/ Inherit（继承会话设置）
- **模型搜索**：包含搜索框，实时过滤模型列表
- **Provider 分组**：按 AI 提供商分组显示模型
- **Thinking 配置**：Anthropic 模型的 Thinking Budget 滑块（1024 ~ maxOutputTokens - 1）
- **上下文长度**：显示当前模型的上下文窗口长度，支持压缩阈值设置
- **价格信息**：显示输入/输出价格（$/M tokens）
- **Vision 支持**：标记模型是否支持视觉能力

### 9.3 模型选择解析

通过 `resolveSessionModelSelection()` 函数解析模型选择策略：

```typescript
const selection = resolveSessionModelSelection({
  session,              // 当前会话
  providers,            // 所有可用 Provider
  activeProviderId,     // 当前活跃 Provider
  activeModelId,        // 当前活跃 Model
  globalMode,           // 全局选择模式（从 settings-store 读取）
  channelProviderId,    // 通道关联的 Provider
  channelModelId        // 通道关联的 Model
})
```

### 9.4 设置面板

Setttings 弹出面板包含：
- Model 搜索和选择
- Thinking Budget 设置（仅 Anthropic 模型）
- 上下文压缩阈值设置
- 上下文保留输出预算
- 自动模式切换

---

## 10. Slash 命令与文件搜索弹出层

### 10.1 Slash 命令弹出层

**触发条件**：用户输入 `/` 后，`getSlashCommandQuery()` 返回非 null 查询

**数据源**：
- `BUILTIN_SLASH_COMMANDS` — 内置命令（如 `/help`, `/clear`, `/plan` 等）
- `slashCommands` — 从 `command-loader` 加载的动态命令
- `availableAppPlugins` — 从 `app-plugin-store` 加载的应用插件
- `installedSkills` — 从 `skills-store` 加载的已安装技能

**评分算法**（`scoreSlashCommand`）：

```typescript
function scoreSlashCommand(name: string, query: string): number {
  // 0: 完全匹配
  // 1: 前缀匹配
  // 10+: 包含匹配（索引越大分数越高=越不相关）
  // 100+: 模糊匹配（字符间隙越大分数越高）
  // Infinity: 不匹配
}
```

**快捷键**：`ArrowDown/Up` 切换选择，`Tab/Enter` 确认，`Escape` 关闭

### 10.2 文件搜索弹出层

**触发条件**：在文本中输入 `@` 后，`getSelectFileMentionQuery()` 返回非 null 查询

**搜索流程**：
1. 通过 `ipcClient.invoke('fs:search-files')` 在 `workingFolder` 下搜索文件
2. 120ms 去抖延迟
3. 限制返回 20 条结果
4. 显示文件路径和名称

**快捷键**：`ArrowDown/Up` 切换选择，`Tab/Enter` 确认，`Escape` 取消

---

## 11. 输入草稿持久化

### 11.1 文件位置

- [input-drafts.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/lib/input-drafts.ts) — 数据层，封装 IPC 调用
- [use-input-draft-persistence.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/hooks/use-input-draft-persistence.ts) — Hook 层，管理生命周期

### 11.2 草稿键设计

```typescript
// 会话范围：session:<sessionId>
getSessionInputDraftKey('sess_abc')  → 'session:sess_abc'

// 首页范围：home:<mode>
getHomeInputDraftKey('chat')         → 'home:chat'

// 项目范围：project:<projectId>:<mode>
getProjectInputDraftKey('proj_xyz', 'cowork')  → 'project:proj_xyz:cowork'
```

### 11.3 草稿内容

```typescript
interface InputDraftValue {
  text: string                // 序列化文本（含标签）
  images: ImageAttachment[]   // 图片附件列表
  skill: string | null        // 当前选中的 Skill
  selectedFiles: SelectedFileItem[]  // 选中的文件列表
}
```

### 11.4 保存策略

- **去抖保存**：400ms 的 `setTimeout` 延迟保存，避免频繁写入
- **条件跳过**：流式输出中、禁用状态、草稿未加载时不保存
- **焦点检查**：如果焦点不在输入区域，跳过保存（避免后台保存冲突）
- **空草稿清理**：如果草稿内容为空，自动删除持久化记录

### 11.5 恢复流程

```typescript
useEffect(() => {
  if (!inputDraftHydrated) return

  // 1. 从持久化存储加载草稿
  const persistedText = persistedDraft?.text ?? ''
  const persistedSelectedFiles = persistedDraft?.selectedFiles ?? []

  // 2. 首页特殊处理：如果只有文件引用没有文本，清空
  const shouldResetHomeReferenceDraft = isHomeComposer && isReferenceOnlyDocument(...)

  // 3. 恢复编辑器状态
  applyEditorStateFromSerializedText(persistedText, persistedSelectedFiles)
  setAttachedImages(persistedDraft?.images ?? [])
  setSelectedSkill(persistedDraft?.skill ?? null)

  // 4. 自动聚焦编辑器
  requestAnimationFrame(() => editorRef.current?.focus())
}, [inputDraftHydrated, ...])
```

### 11.6 IPC 通道

```typescript
IPC.INPUT_DRAFT_GET     // 获取草稿
IPC.INPUT_DRAFT_SET     // 保存草稿
IPC.INPUT_DRAFT_REMOVE  // 删除草稿
IPC.INPUT_DRAFT_LIST    // 列出所有草稿
```

通过主进程的 SQLite 持久化存储（`~/.open-cowork/` 目录下）。

---

## 12. Prompt 推荐系统

### 12.1 文件位置

[use-prompt-recommendation.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/hooks/use-prompt-recommendation.ts)

### 12.2 功能

- 根据当前输入文本和会话上下文，生成 Prompt 推荐建议
- 建议显示为灰色文本（通过 `FileAwareEditor` 的 `suggestionText` prop）
- Tab 键接受建议

### 12.3 自动接受模式

在 `clarify` 模式下，如果 `clarifyAutoAcceptRecommended` 开启，支持自动倒计时接受：

```typescript
useEffect(() => {
  if (!shouldAutoAcceptRecommendation || !suggestionText || !text.trim()) return

  // 8 秒倒计时
  setAutoAcceptCountdown(8)

  // 每秒更新倒计时
  intervalId = setInterval(() => { ... }, 1000)

  // 8 秒后自动接受
  timeoutId = setTimeout(() => {
    acceptSuggestion()
    applyEditorStateFromSerializedText(acceptedSuggestion)
  }, 8000)
}, [...])
```

---

## 13. Token 计数器

### 13.1 位置

- Hook: [use-estimated-tokens.ts](file:///d:/Administrator/Desktop/OpenCowork-main/src/renderer/src/hooks/use-estimated-tokens.ts)
- `useDebouncedTokens(finalSerializedText)` — 返回去抖后的 Token 估算值

### 13.2 显示位置

`ComposerRuntimeStatus` 组件在底部状态栏显示 Token 计数、模型名称、上下文压缩状态等信息。

---

## 14. 上下文压缩

### 14.1 触发方式

- 手动点击 `ContextRing` 组件（输入框右下角的环形图标）
- 通过 `onCompressContext` 回调触发

### 14.2 状态流转

```
idle → compressing → compressed | skipped | blocked | failed → (3.2s 后) → idle
```

### 14.3 状态显示

`ContextRing` 组件根据状态显示不同颜色和图标：
- `compressing`: 旋转动画
- `compressed`: 绿色对勾
- `failed`: 红色警告
- `blocked`: 灰色禁止

---

## 15. 消息队列系统

### 15.1 概念

当用户在前一条消息还在流式输出时发送新消息，新消息不会立即发送，而是进入"待发送队列"（Pending Queue）。

### 15.2 队列管理

- `pendingSessionMessages` — 通过 `useSyncExternalStore` 订阅的全局待发送队列
- `editingQueueItemId` — 当前正在编辑的队列消息
- `editingQueueText` / `editingQueueImages` — 编辑中的内容

### 15.3 队列操作

| 操作 | 函数 | 说明 |
|------|------|------|
| 编辑 | `startEditQueuedMessage(msg)` | 展开队列消息的编辑面板 |
| 保存 | `saveQueuedMessage(id)` | 保存编辑后的草稿 |
| 删除 | `removeQueuedMessage(id)` | 删除单条队列消息 |
| 清空 | `clearQueuedMessagesForActiveSession()` | 清空所有队列消息（带确认对话框） |
| 引用 | `quoteQueuedMessage(id)` | 将队列消息引用到当前对话中 |
| 恢复 | `resumeQueuedMessages()` | 恢复暂停的队列调度 |

### 15.4 队列显示

队列消息显示在输入框上方，每条显示：
- `CornerDownRight` 图标（表示待发送）
- 截断的文本摘要（最多 72 字符）
- 命令标签（如 `/plan`）
- 图片数量
- 操作按钮：恢复/引用/删除/更多

---

## 16. 数据流总结

### 16.1 用户输入流程

```
用户输入
  │
  ▼
FileAwareEditor (contentEditable)
  │ onDocumentChange
  ▼
InputArea.documentNodes (EditorDocumentNode[])
  │
  ├── editorDocumentToPlainText() → text (用于显示/Token 估算)
  ├── serializeEditorDocument() → finalSerializedText (用于发送/持久化)
  └── serializeEditorDocument({ expandPluginPrompts: true }) → promptText (发送给 LLM)
```

### 16.2 发送流程

```
用户点击发送 / Enter
  │
  ▼
handleSend()
  │
  ├── getLiveEditorState() → 获取实时编辑器状态
  ├── 构建消息文本 (含 [Skill: xxx] 前缀)
  ├── 构建 SendMessageOptions (含文件引用/计划模式/目标)
  ├── onSend(message, images, options)
  │
  ▼
useChatActions.sendMessage()
  │
  ├── buildSystemPrompt()
  ├── resolveSessionModelSelection()
  ├── registerTools()
  └── ipcClient.invoke(IPC.AGENT_STREAM)
```

### 16.3 草稿持久化流程

```
用户输入变化
  │
  ├── textRef.current = text (保持引用同步)
  └── 400ms 去抖定时器
      │
      ▼
  savePersistedDraft({ text, images, skill, selectedFiles })
      │
      ▼
  IPC.INPUT_DRAFT_SET → 主进程 SQLite 存储
      │
      ▼
  setCachedInputDraft() → 内存缓存 (用于快速恢复)
```

### 16.4 文件引用生命周期

```
用户 @ 搜索文件 → 文件弹出层 → 选择文件 → insertSelectedFile()
  │
  ▼
ensureSelectedFile() → 将文件路径加入 selectedFiles
  │
  ▼
replaceSelectionWithText() → 在 documentNodes 中插入 FileNode + @{} 标签
  │
  ▼
序列化 → <select-file>path/to/file</select-file>
  │
  ▼
发送 → onSend() → IPC → 主进程 → LLM 收到文件路径
  │
  ▼
用户删除引用 → removeReferenceNode() → 清理 documentNodes 和 selectedFiles
```