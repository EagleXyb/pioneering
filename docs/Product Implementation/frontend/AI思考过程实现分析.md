# AI 思考过程实现分析

> 分析日期：2026-05-25
> 涉及范围：backend（NestJS）、frontend（React Web）、miniprogram（Taro）

---

## 一、概览

AI 思考过程（Thinking/Reasoning Process）的实现贯穿**后端 → 前端（Web + 小程序）**三层，核心思路是：**将 AI 模型返回的推理过程与正文回答分离，在前端以可折叠 UI 展示**。

整体架构如下：

```
用户输入 → 前端发送请求
    ↓
后端 ChatController → ChatService.streamChatCompletion
    ↓
LlmService.streamChat → 调用第三方 LLM API (SSE)
    ↓
后端解析 SSE delta:
  ├─ reasoning_content → type: "thinking"
  ├─ content + <think> 标签  → parseThinkTags → type: "thinking" / "answer"
  └─ 普通 content → type: "answer"
    ↓
前端接收 SSE (fetch ReadableStream / Taro onChunkReceived)
    ↓
useStreamChat / useSSE:
  ├─ type: "thinking" → thinkingBuffer 累积
  ├─ type: "answer"   → answerBuffer 累积
  └─ 无 type（兜底）   → 前端自行解析 <think> 标签
    ↓
DisplayMessage / ChatMessage:
  ├─ thinkingContent → 可折叠时间线/面板
  └─ answerContent   → Markdown 渲染的正文
```

---

## 二、后端层（NestJS）

### 2.1 核心文件

- [backend/src/api-v1/common/llm.service.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/common/llm.service.ts) — LLM 模型调用、SSE 流式解析
- [backend/src/api-v1/chat/chat.service.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/chat/chat.service.ts) — 对话补全、消息持久化

### 2.2 双路径解析策略

LLM 服务支持两种方式分离思考内容：

#### 路径 A：模型原生 `reasoning_content`

适用于 DeepSeek、Qwen 等原生支持 Chain-of-Thought 的模型。API 返回的 delta 中带有独立的 `reasoning_content` 字段。

```typescript
// streamOpenAICompatible() 方法关键代码
const reasoningContent = delta.reasoning_content || '';
const content = delta.content || '';

if (reasoningContent) {
  hasReasoningContent = true;
  // 直接以 type: 'thinking' 发送
  res.write(`data: ${JSON.stringify({ type: 'thinking', content: reasoningContent })}\n\n`);
}
if (content) {
  if (hasReasoningContent) {
    // 已有推理内容，后续 content 都作为 answer
    res.write(`data: ${JSON.stringify({ type: 'answer', content })}\n\n`);
  }
}
```

#### 路径 B：`<think>` 标签解析

适用于 MiniMax、GLM 等不支持 `reasoning_content` 的模型。模型将思考内容包裹在 `<think>...</think>` 标签中。

```typescript
// parseThinkTags() 方法
private parseThinkTags(
  content: string,
  currentInThinkBlock: boolean,
): { chunks: { type: string; content: string }[]; inThinkBlock: boolean } {
  const chunks: { type: string; content: string }[] = [];
  let inThink = currentInThinkBlock;
  let remaining = content;

  while (remaining.length > 0) {
    if (inThink) {
      const closeIdx = remaining.indexOf('</think');
      if (closeIdx !== -1) {
        // 提取思考内容
        const thinkPart = remaining.slice(0, closeIdx);
        if (thinkPart) chunks.push({ type: 'thinking', content: thinkPart });
        remaining = remaining.slice(closeIdx + '</think'.length);
        inThink = false;
      } else {
        chunks.push({ type: 'thinking', content: remaining });
        remaining = '';
      }
    } else {
      const openIdx = remaining.indexOf('<think');
      if (openIdx !== -1) {
        // 提取标签前的 answer 内容
        const answerPart = remaining.slice(0, openIdx);
        if (answerPart) chunks.push({ type: 'answer', content: answerPart });
        remaining = remaining.slice(openIdx + '<think'.length);
        inThink = true;
      } else {
        chunks.push({ type: 'answer', content: remaining });
        remaining = '';
      }
    }
  }
  return { chunks, inThinkBlock: inThink };
}
```

该方法维护 `inThinkBlock` 状态机，可处理流式场景下标签跨 chunk 到达的情况。

### 2.3 SSE 数据格式

后端统一输出以下 SSE 事件格式：

```
data: {"type": "thinking", "content": "思考过程文字..."}
data: {"type": "answer", "content": "最终回答文字..."}
data: {"type": "done"}
```

### 2.4 消息持久化

Chat 服务的 `streamChatCompletion` 方法通过包装 `res.write` 拦截 SSE 数据，收集所有 `type: "answer"` 的 chunk 拼接为完整回复，存入数据库。

> **⚠️ 注意**：当前数据库 `ChatMessage` 表的 `content` 字段存储的是**完整回复（含 thinking + answer 合并后的原始内容）**，没有独立的 `thinkingContent` 或 `answerContent` 字段。思考内容在流式传输后不会单独持久化。

相关文件：

- [schema.prisma](file:///c:/Users/HS/Desktop/pioneering/backend/prisma/schema.prisma#L95-L115) — `ChatMessage` 模型定义
- [chat.service.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/chat/chat.service.ts#L333-L425) — `streamChatCompletion` 方法

### 2.5 支持的模型 provider

| Provider | 思考分离方式 |
|----------|-------------|
| DeepSeek | `reasoning_content` |
| Qwen | `reasoning_content` |
| GLM (智谱) | `<think>` 标签兜底 |
| Kimi (月之暗面) | `<think>` 标签兜底 |
| MiniMax | `<think>` 标签兜底 |

---

## 三、前端 Web 层（React）

### 3.1 核心文件

- [frontend/services/llmService.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/services/llmService.ts) — SSE 流式请求与回调分发
- [frontend/pages/trial-center/chat/hooks/useStreamChat.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/hooks/useStreamChat.ts) — 流式 chunk 解析与双 buffer 管理
- [frontend/pages/trial-center/chat/hooks/useChat.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/hooks/useChat.ts) — 聊天主逻辑（发送、重试、停止）
- [frontend/pages/trial-center/chat/components/ChatMessage.tsx](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/components/ChatMessage.tsx) — 消息渲染（思考时间线）
- [frontend/pages/trial-center/utils/stripThinkTags.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/utils/stripThinkTags.ts) — 清理 `<think>` 标签
- [frontend/pages/trial-center/types/index.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/types/index.ts) — `DisplayMessage` 类型定义
- [frontend/pages/trial-center/chat/styles/chat.css](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/styles/chat.css) — 思考时间线样式

### 3.2 SSE 接收（llmService.ts）

通过 `fetch` + `ReadableStream` 消费 SSE，根据 `parsed.type` 区分回调：

```typescript
if (parsed.type === 'thinking') {
  callbacks.onChunk(parsed.content, 'thinking');
} else if (parsed.type === 'answer') {
  callbacks.onChunk(parsed.content, 'answer');
}
```

### 3.3 流式解析（useStreamChat.ts）

**双路径设计**：

1. **路径 1（优先）**：如果后端已标记 `type: 'thinking'` / `type: 'answer'`，直接追加到对应 buffer
2. **路径 2（兜底）**：如果后端未分类，前端自行解析 `<think>` 标签

核心状态机：

```typescript
interface StreamState {
  inThinkBlock: boolean;      // 当前是否在 think 块内
  thinkBuffer: string;        // 思考内容累积
  answerBuffer: string;       // 回答内容累积
  pendingThinkTag: string;    // 跨 chunk 的不完整标签缓冲
}
```

`pendingThinkTag` 用于处理 `<think` 开标签跨 chunk 到达的情况（如先收到 `<thin` 再收到 `k>`）。

### 3.4 数据结构（DisplayMessage）

```typescript
export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;           // 默认显示内容（即 answerContent）
  thinkingContent?: string;  // 思考内容（独立存储）
  answerContent?: string;    // 回答内容（独立存储）
  status: 'loading' | 'success' | 'error' | 'block';
  error?: string;
  timestamp: number;
}
```

### 3.5 UI 渲染（ChatMessage.tsx）

#### 思考时间线（Thinking Timeline）

将思考内容按空行拆分为多个步骤：

```typescript
function parseThinkingSteps(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
```

##### 渲染逻辑

| 状态 | 展示内容 |
|------|---------|
| 加载中，无 thinking 无 answer | "正在思考..." 动画 |
| 加载中，有 thinking 无 answer | 思考按钮 + "思考中..." + 时间线 |
| 加载中，有 thinking 有 answer | 思考按钮 + 时间线 + Markdown 正文 |
| 完成 | "已完成思考" 按钮 + 时间线 + Markdown 正文 + 操作按钮 |

##### UI 结构

```
┌─────────────────────────────────────┐
│  ✨ 已完成思考 / 思考中...    ▼      │  ← 切换按钮
├─────────────────────────────────────┤
│  ● 思考步骤 1                       │  ← 时间线步骤
│  ● 思考步骤 2                       │
│  ● 思考步骤 3                       │
│  ◯ 已完成思考                       │  ← 完成标记
├─────────────────────────────────────┤
│  ### 最终回答                       │  ← Markdown 正文
│  这里是 AI 的回答内容...             │
├─────────────────────────────────────┤
│  📋 👍 👎 🔗 🔄                    │  ← 操作按钮
└─────────────────────────────────────┘
```

#### 时间线 CSS 实现

- **容器**：`.thinking-timeline`，`position: relative`，伪元素 `::before` 绘制左侧竖线
- **节点列**：`.thinking-step-node`，紫色圆点（`#8B5CF6`），伪元素 `::after` 绘制节点间连接竖线
- **最后一个步骤**：通过 `[data-is-last="true"]::after { display: none }` 隐藏竖线
- **完成标记**：绿色对勾 SVG，表示思考阶段结束
- **动画**：`.thinking-icon.animate` → `thinkingPulse` keyframe（脉冲+旋转）

### 3.6 标签清理（stripThinkTags.ts）

用于在展示思考内容前清理标签残留：

```typescript
export function stripThinkTags(content: string): string {
  return content
    .replace(/<think[^>]*>/gi, '')
    .replace(/<\/think\s*>/gi, '');
}
```

---

## 四、小程序层（Taro）

### 4.1 核心文件

- [miniprogram/src/services/sse.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/services/sse.ts) — SSE 连接与解析
- [miniprogram/src/hooks/useSSE.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/hooks/useSSE.ts) — SSE 状态管理与流式累积
- [miniprogram/src/hooks/useConversation.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/hooks/useConversation.ts) — 消息构建与会话管理
- [miniprogram/src/pages/chat/hooks/useChatLogic.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/pages/chat/hooks/useChatLogic.ts) — 聊天主逻辑
- [miniprogram/src/components/chat-message/index.tsx](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/components/chat-message/index.tsx) — 消息 UI 渲染
- [miniprogram/src/types/chat.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/types/chat.ts) — 类型定义

### 4.2 SSE 连接（sse.ts）

使用 Taro 的 `enableChunked` + `onChunkReceived` 实现流式接收：

```typescript
function parseSSELine(line: string): SSEChunk | null {
  if (!line.startsWith('data: ')) return null;

  const raw = line.slice(6).trim();
  if (raw === '[DONE]') return { type: 'done', data: '' };

  try {
    const parsed = JSON.parse(raw);
    return {
      type: parsed.type || 'content',
      data: parsed.data || parsed.content || raw,
    };
  } catch {
    // 兜底：正则匹配 <thinking>...</thinking>
    if (raw.startsWith('<thinking>') && raw.includes('</thinking>')) {
      const thinkMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (thinkMatch) {
        return { type: 'thinking', data: thinkMatch[1] };
      }
    }
    return { type: 'content', data: raw };
  }
}
```

### 4.3 状态管理（useSSE.ts）

维护 `streamingContent` 和 `thinkingContent` 两个独立状态：

```typescript
const [streamingContent, setStreamingContent] = useState('');
const [thinkingContent, setThinkingContent] = useState('');
```

同时支持 Mock 模式（`USE_MOCK = true`），用于开发和演示。

### 4.4 消息流程（useChatLogic.ts）

定义了 `ChatPhase` 状态机：

```typescript
export type ChatPhase = 'idle' | 'thinking' | 'generating' | 'completed';
```

| 阶段 | 说明 |
|------|------|
| `idle` | 空闲状态 |
| `thinking` | SSE 连接中，等待数据（显示"思考中"） |
| `generating` | 正在接收流式内容 |
| `completed` | 流式完成（成功/错误/停止） |

### 4.5 UI 渲染（chat-message）

小程序端采用简化的**折叠面板**设计，而非 Web 端的复杂时间线：

```
┌──────────────────────────────┐
│  ▸ 思考过程                  │  ← 可折叠头部（点击展开/收起）
├──────────────────────────────┤
│  思考内容文字...             │  ← 纯文本展示
│                              │
│  ...                         │
├──────────────────────────────┤
│  (Markdown 渲染的正文)       │
│  │ 光标（streaming 时）       │
├──────────────────────────────┤
│  [已停止生成]（stopped 时）   │
│  [重新生成]                  │
└──────────────────────────────┘
```

### 4.6 数据类型

```typescript
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error';

export interface ChatMessage {
  id: string;
  sessionId: string;
  content: string;
  thinkingContent?: string;  // 思考内容
  isUser: boolean;
  status: MessageStatus;
  timestamp: number;
  error?: string;
}
```

---

## 五、关键设计要点总结

| 方面 | 设计决策 | 位置 |
|------|---------|------|
| **后端解析** | 双路径：优先用模型原生 `reasoning_content`，兜底解析 `<think>` 标签 | [llm.service.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/common/llm.service.ts) |
| **流式状态机** | `inThinkBlock` 标记跨 chunk 处理不完整标签 | 后端 `parseThinkTags` + 前端 `processStreamChunk` |
| **前后端兜底** | 后端已分类时前端直接用；未分类时前端自行解析 | [useStreamChat.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/hooks/useStreamChat.ts) |
| **数据持久化** | 当前不持久化 thinkingContent 到数据库（只有 `content` 字段） | [schema.prisma](file:///c:/Users/HS/Desktop/pioneering/backend/prisma/schema.prisma) |
| **Web 端 UI** | 时间线样式：紫色圆点 + 竖线连接线，Markdown 渲染步骤，展开/折叠 | [ChatMessage.tsx](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/components/ChatMessage.tsx) |
| **小程序 UI** | 简化折叠面板：纯文本展示思考内容 | [chat-message/index.tsx](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/components/chat-message/index.tsx) |
| **超时机制** | 15s 无数据超时兜底 | [useStreamChat.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/hooks/useStreamChat.ts) + [sse.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/services/sse.ts) |
| **Mock 支持** | 小程序端有 Mock 模式，可模拟思考 + 回答流 | [mock.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/services/mock.ts) |

---

## 六、文件索引

### 后端
| 文件 | 作用 |
|------|------|
| [backend/src/api-v1/common/llm.service.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/common/llm.service.ts) | LLM 配置管理、流式/非流式调用、SSE 解析 |
| [backend/src/api-v1/chat/chat.service.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/chat/chat.service.ts) | 会话管理、消息 CRUD、流式补全 |
| [backend/src/api-v1/chat/chat.controller.ts](file:///c:/Users/HS/Desktop/pioneering/backend/src/api-v1/chat/chat.controller.ts) | 聊天 API 路由 |
| [backend/prisma/schema.prisma](file:///c:/Users/HS/Desktop/pioneering/backend/prisma/schema.prisma) | 数据库模型定义 |

### 前端 Web
| 文件 | 作用 |
|------|------|
| [frontend/services/llmService.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/services/llmService.ts) | SSE 流式请求 |
| [frontend/pages/trial-center/chat/hooks/useStreamChat.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/hooks/useStreamChat.ts) | 流式 chunk 解析与状态管理 |
| [frontend/pages/trial-center/chat/hooks/useChat.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/hooks/useChat.ts) | 聊天主逻辑 |
| [frontend/pages/trial-center/chat/components/ChatMessage.tsx](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/components/ChatMessage.tsx) | 消息渲染 |
| [frontend/pages/trial-center/utils/stripThinkTags.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/utils/stripThinkTags.ts) | 标签清理 |
| [frontend/pages/trial-center/types/index.ts](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/types/index.ts) | 类型定义 |
| [frontend/pages/trial-center/chat/styles/chat.css](file:///c:/Users/HS/Desktop/pioneering/frontend/pages/trial-center/chat/styles/chat.css) | 思考时间线样式 |

### 小程序
| 文件 | 作用 |
|------|------|
| [miniprogram/src/services/sse.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/services/sse.ts) | SSE 连接与解析 |
| [miniprogram/src/hooks/useSSE.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/hooks/useSSE.ts) | SSE 状态管理 |
| [miniprogram/src/hooks/useConversation.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/hooks/useConversation.ts) | 消息与会话管理 |
| [miniprogram/src/pages/chat/hooks/useChatLogic.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/pages/chat/hooks/useChatLogic.ts) | 聊天主逻辑 |
| [miniprogram/src/components/chat-message/index.tsx](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/components/chat-message/index.tsx) | 消息 UI |
| [miniprogram/src/types/chat.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/types/chat.ts) | 类型定义 |
| [miniprogram/src/services/mock.ts](file:///c:/Users/HS/Desktop/pioneering/miniprogram/src/services/mock.ts) | Mock 流式生成器 |

### 设计文档
| 文件 | 作用 |
|------|------|
| [docs/Product Implementation/frontend/思维链步骤.md](file:///c:/Users/HS/Desktop/pioneering/docs/Product%20Implementation/frontend/思维链步骤.md) | 时间线组件设计 |
| [docs/Product Implementation/frontend/问题本质：思维链过滤方案探讨.md](file:///c:/Users/HS/Desktop/pioneering/docs/Product%20Implementation/frontend/问题本质：思维链过滤方案探讨.md) | 思维链过滤方案 |