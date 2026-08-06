# 08 · 技术债务标注

> 按严重度与影响范围梳理。**高** = 影响正确性/安全/性能，建议优先处理；**中** = 影响可维护性；**低** = 优化项。

## 1. 高优先级

### 1.1 IPC 路径安全校验
- **位置**：`src/main/ipc-handlers.ts` 文件读写相关 handler。
- **问题**：文件 `read`/`write` 需严格校验路径，防止越权访问（如 `..` 穿越、写入任意系统路径）。
- **建议**：统一路径白名单/沙箱校验，限制在工作区目录内。

### 1.2 Markdown 安全策略一致性
- **位置**：`components/chat/MarkdownRenderer.tsx`。
- **现状**：已统一 sanitize schema（剥离 `on*`、危险协议，白名单 http(s)/mailto），代码块高亮 className 保留。
- **风险**：自定义 sanitize schema 需持续跟进 `hast-util-sanitize` 版本变更，避免回归。
- **建议**：增加针对 Markdown 渲染的安全用例测试。

### 1.3 流式中止与回滚
- **位置**：`chatStore.stopStreaming` / `stream-handler`。
- **问题**：中止后需保证 assistant 占位消息状态正确（done/error），避免残留 `streaming` 态。
- **建议**：补全中止路径的边界测试。

## 2. 中优先级

### 2.1 消息列表长会话性能
- **位置**：`components/chat/MessageScrollerList.tsx`。
- **现状**：改用 shadcn `MessageScroller`（`content-visibility:auto`），不虚拟化。
- **风险**：超长会话（数千条）下 DOM 数量仍可能影响性能。
- **建议**：设定会话长度阈值，必要时引入轻量虚拟化或分页加载历史。

### 2.2 会话历史持久化策略
- **位置**：`stores/chatStore.ts`。
- **问题**：会话内存态与本地落盘的关系需明确；当前持久化链路以代码实现为准，缺统一文档。
- **建议**：明确持久化触发点（每次更新/防抖），并增加恢复时的容错。

### 2.3 trace 扁平与树状双路径
- **位置**：`Message` 同时支持 `toolCalls`（扁平）与 `traceNodes`（树）。
- **问题**：双路径增加渲染分支与维护成本。
- **建议**：后端稳定输出 trace 后，逐步弃用扁平 `toolCalls` 路径。

### 2.4 输入区 Token 计数
- **位置**：`lib/input/select-file-editor.ts`。
- **问题**：文档模型已就绪，但实际 Token 计数依赖后端或未接入。
- **建议**：接入计数后补全 UI 提示与超限校验。

### 2.5 会话列表与消息列表虚拟化方案不统一
- **位置**：`ConversationList` 用 `@tanstack/react-virtual`；`MessageScrollerList` 不虚拟化。
- **问题**：两套滚动方案并存，心智成本略高。
- **建议**：长期评估是否统一为同一方案。

## 3. 低优先级

### 3.1 组件目录粒度
- **位置**：`components/chat/` 组件较多，部分（如 trace 相关）可考虑独立子目录。
- **建议**：在规模进一步增长时做子目录归组。

### 3.2 类型重复与本地补充
- **位置**：`src/renderer/src/types/` 与 `shared/types.ts`。
- **问题**：渲染层补充类型与共享类型边界需明确，避免重复定义。
- **建议**：统一以 `shared/types.ts` 为单一事实源，渲染层只补充 UI 专用类型。

### 3.3 开发期 Mock 完整度
- **位置**：`mocks/electron-mock.ts`。
- **问题**：需随 `preload` 暴露的 API 同步更新，否则纯浏览器调试出现缺方法。
- **建议**：在 CI 增加 mock 与 preload API 签名一致性检查（类型层）。

### 3.4 注释中的阶段标记
- **位置**：多处注释含 `T04`/`T05`/`M2`/`P0`/`H7` 等阶段标记。
- **问题**：对新人理解有门槛，且随时间失效。
- **建议**：保留关键决策注释，清理过时阶段标记或补充 glossary。

## 4. 待确认项

- 会话历史是否走 IPC 落盘，还是仅内存态 + 后端持久化？
- `agui.ts` 与 `agent.ts` 的职责边界与调用方？
- 设置项（`settingsConfig`）中哪些已真正生效、哪些仅 UI 占位？
