# 03 - Preload 安全桥接层

## 概述

Preload 层是 Electron 安全架构的核心组件，位于主进程和渲染进程之间。它通过 `contextBridge` 暴露有限且定义良好的 API 给渲染进程，确保渲染进程无法直接访问 Node.js 或 Electron 原生 API。

**文件**: `src/preload/index.ts`

## contextBridge 暴露的 API

Preload 层通过 `contextBridge` 在 `window` 对象上暴露两个命名空间：

### `window.electron` — 标准 Electron API

通过 `@electron-toolkit/preload` 包提供：

```typescript
contextBridge.exposeInMainWorld('electron', electronAPI)
```

包含 Electron 标准 API 的子集，如进程信息、文件对话框等。

### `window.api` — 10 个自定义方法

OpenCowork 自定义的渲染进程 API：

| 方法 | 用途 |
|------|------|
| `downloadImage(args)` | 下载图片到本地文件系统 |
| `fetchImageBase64(args)` | 获取图片的 Base64 编码 |
| `writeImageToClipboard(args)` | 写入图片到剪贴板 |
| `teamRuntimeCreate(args)` | 创建 Team Runtime |
| `teamRuntimeDelete(args)` | 删除 Team Runtime |
| `teamRuntimeAppendMessage(args)` | 追加消息到 Team Runtime |
| `teamRuntimeGetSnapshot(args)` | 获取 Team Runtime 快照 |
| `teamRuntimeUpdateMember(args)` | 更新 Team Runtime 成员 |
| `teamRuntimeUpdateManifest(args)` | 更新 Team Runtime Manifest |
| `teamRuntimeConsumeMessages(args)` | 消费 Team Runtime 消息 |

## MessagePack 二进制 IPC

所有自定义 API 都使用 MessagePack 二进制编码：

```typescript
async function invokeMessagePackBinary<T>(channel: string, payload: unknown): Promise<T> {
  const response = await ipcRenderer.invoke(
    toMessagePackChannel(channel),
    encodeMessagePackPayload(payload)
  )
  return decodeMessagePackPayload<T>(response as ArrayBuffer | ArrayBufferView)
}
```

流程：
1. 渲染进程调用 `api.xxx(args)` 
2. Preload 将参数编码为 MessagePack `Uint8Array`
3. 通过 `ipcRenderer.invoke()` 发送到主进程
4. 主进程的 MessagePack Handler 解码参数并处理
5. 结果编码为 MessagePack 返回给渲染进程

## 类型声明 (`src/preload/index.d.ts`)

类型声明文件为 `Window` 全局类型增加声明：

```typescript
declare global {
  interface Window {
    electron: ElectronAPI
    api: OpenCoworkAPI
  }
}
```

`OpenCoworkAPI` 接口明确定义了所有 10 个方法的签名，确保渲染进程可以获得完整的 TypeScript 类型支持。

## 安全设计原则

1. **最小权限原则** — 只暴露渲染进程绝对需要的方法
2. **类型安全** — 所有 API 参数和返回值都有明确的类型定义
3. **二进制协议** — MessagePack 编码减少攻击面（非 JSON 字符串）
4. **隔离执行** — `contextIsolation` 确保渲染进程无法访问 Node.js API
5. **无法绕过** — 自定义 API 通过 `contextBridge` 注册，不可被渲染进程修改

## IPC 通信安全

Preload 层是渲染进程与主进程通信的唯一入口：

- 所有文件操作必须经过 IPC 通道
- 所有数据库访问必须经过 IPC 通道
- Shell 命令执行需要用户审批
- 密钥信息通过 `secure-key-store.ts` 加密存储