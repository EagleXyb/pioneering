import type { ApiResponse } from './request';

// ====== 模拟 AI 回复 ======
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
