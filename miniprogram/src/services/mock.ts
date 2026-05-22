import type { ApiResponse } from './request';

// ====== 模拟 AI 回复（支持流式） ======
const REPLIES = [
  '我是你的创路伙伴，有什么可以帮你的？',
  '明白，我正在理解你的问题...',
  '这个问题很有意思，我来解答一下。',
  '你说的内容我已经收到啦！',
  '好的，这是一个很好的方向！让我帮你深入分析。',
  '我理解你的顾虑，这确实是很多人在这个阶段会有的感受。',
  '从你刚才说的来看，我建议我们从最核心的问题开始梳理。',
  '太好了！这个想法很有潜力，我们一起来把它变得更具体吧。',
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let msgCounter = 0;
function nextId(): string {
  return `mock_${++msgCounter}_${Date.now()}`;
}

// ====== 非流式 Mock ======
const mockHandlers: Record<string, (data: any) => Promise<ApiResponse<any>>> = {
  '/chat/message': async (_data) => {
    await delay(600 + Math.random() * 800);
    const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)];
    return {
      code: 0,
      data: {
        message: { id: nextId(), content: reply, type: 'text' },
        quickReplies: [],
        phase: 0,
      },
      message: 'success',
    };
  },
};

export function getMockHandler(url: string): ((data?: any) => Promise<ApiResponse<any>>) | undefined {
  return mockHandlers[url];
}

// ====== Mock SSE 流式响应生成器 ======
export interface MockStreamConfig {
  content: string;
  chunkSize?: number;
  chunkDelay?: number;
  useThinking?: boolean;
}

export async function* generateMockStream(config: MockStreamConfig): AsyncGenerator<{ type: 'thinking' | 'content'; data: string }> {
  const { content, chunkSize = 3, chunkDelay = 60, useThinking = false } = config;

  if (useThinking) {
    // 模拟思考过程
    const thinking = '正在分析问题... 检索相关知识... 组织回答内容...';
    for (let i = 0; i < thinking.length; i += chunkSize) {
      await delay(chunkDelay);
      yield { type: 'thinking', data: thinking.slice(i, i + chunkSize) };
    }
    await delay(200);
  }

  // 模拟正文流式输出
  for (let i = 0; i < content.length; i += chunkSize) {
    await delay(chunkDelay);
    yield { type: 'content', data: content.slice(i, i + chunkSize) };
  }
}