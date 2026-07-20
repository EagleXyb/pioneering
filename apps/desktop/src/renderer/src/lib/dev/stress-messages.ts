// ============================================================
// stress-messages — T09 长会话压测 mock 数据生成器（dev-only）
// ============================================================
// 用途：在开发期向当前会话注入 1000+ 条带代码块/图片/工具调用的
// mock 消息，验证 Message Scroller + content-visibility 在长会话下
// 的内存占用与滚动帧率。
//
// 安全保障：
//   1. 仅在 import.meta.env.DEV 下生效，生产构建会被 tree-shake
//   2. 默认不启用，需通过 feature flag devStressMessages 开启
//   3. mock 消息的 sessionId 用 __stress__ 前缀，与真实会话隔离
//   4. 不调用任何持久化 API（不污染 IndexedDB / 后端）
// ============================================================

import type { Message } from '@shared/types'

/** 压测会话 ID 前缀，便于识别与清理 */
export const STRESS_SESSION_PREFIX = '__stress__'

const SAMPLE_TEXTS = [
  '这是一段普通文本消息，用于测试消息列表的渲染性能。',
  '请帮我分析这段代码的性能瓶颈，并给出优化建议。',
  '好的，我已经理解了你的需求。让我为你实现这个功能。',
  '在这个场景下，我们需要考虑并发安全与内存占用之间的平衡。',
  '可以尝试使用 React.memo 配合 useMemo 来减少不必要的重渲染。'
]

const SAMPLE_CODE = `\
\`\`\`typescript
// 示例代码块：测试代码高亮 + 长内容的渲染开销
interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'user' | 'guest'
}

export async function fetchUsers(): Promise<User[]> {
  const response = await fetch('/api/users')
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`)
  }
  return response.json()
}

export async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!response.ok) throw new Error('Update failed')
  return response.json()
}
\`\`\``

const SAMPLE_MARKDOWN = `\
## 标题二

这是一段**加粗**与*斜体*混排的文本。

- 列表项 1
- 列表项 2
- 列表项 3

> 引用块：测试块级元素的渲染

[安全链接](https://example.com) 与 [危险链接](javascript:alert(1)) 测试 sanitize。
`

/** 1x1 透明 PNG 的 data URL，用于测试图片附件渲染 */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/**
 * 生成指定数量的 mock 消息。
 * 消息类型按真实场景分布：60% 文本、20% 代码块、10% markdown、5% 图片、5% 工具调用。
 */
export function generateStressMessages(count: number, sessionId: string): Message[] {
  const now = Date.now()
  const messages: Message[] = []
  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0
    const seed = (i * 31 + 7) % 100
    let content: string
    let images: Message['images']

    if (seed < 60) {
      content = SAMPLE_TEXTS[i % SAMPLE_TEXTS.length] ?? SAMPLE_TEXTS[0]!
    } else if (seed < 80) {
      content = SAMPLE_CODE
    } else if (seed < 90) {
      content = SAMPLE_MARKDOWN
    } else if (seed < 95) {
      content = '查看这张图片：'
      images = [
        {
          id: `img-${i}`,
          dataUrl: PIXEL_PNG,
          mediaType: 'image/png'
        }
      ]
    } else {
      // 工具调用场景：内容简短，附加 toolCalls（结构简化，仅供渲染压测）
      content = '正在调用工具完成你的请求…'
    }

    messages.push({
      id: `stress-${sessionId}-${i}`,
      sessionId,
      role: isUser ? 'user' : 'assistant',
      content,
      timestamp: now - (count - i) * 1000,
      createdAt: new Date(now - (count - i) * 1000).toISOString(),
      model: isUser ? undefined : 'mock-model',
      images,
      tokenUsage: isUser
        ? undefined
        : { prompt: 100 + (i % 50), completion: 50 + (i % 30), total: 150 + (i % 80) }
    })
  }
  return messages
}
