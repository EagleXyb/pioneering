import { useState, useCallback, useRef, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { CHAT_ROLES, MESSAGE_STATUS } from '@/constants';
import { generateId } from '@/utils';

interface Message {
  id: number;
  role: string;
  content: string;
  status?: string;
  timestamp?: number;
  thinking?: boolean;
}

export function useChatSession(initialMode?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState(initialMode || 'brainstorm');
  const abortRef = useRef<boolean>(false);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending) return;
      abortRef.current = false;

      const userMsg: Message = {
        id: generateId(),
        role: CHAT_ROLES.USER,
        content: content.trim(),
        timestamp: Date.now(),
        status: MESSAGE_STATUS.SUCCESS,
      };
      const aiMsg: Message = {
        id: generateId(),
        role: CHAT_ROLES.ASSISTANT,
        content: '',
        timestamp: Date.now(),
        status: MESSAGE_STATUS.LOADING,
        thinking: true,
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setIsSending(true);

      try {
        if (abortRef.current) return;
        const response = await mockStreamResponse(content, mode);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? {
                  ...m,
                  content: response,
                  status: MESSAGE_STATUS.SUCCESS,
                  thinking: false,
                }
              : m,
          ),
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? { ...m, status: MESSAGE_STATUS.ERROR, content: '' }
              : m,
          ),
        );
      } finally {
        setIsSending(false);
      }
    },
    [isSending, mode],
  );

  const stopGenerate = useCallback(() => {
    abortRef.current = true;
    setIsSending(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.status === MESSAGE_STATUS.LOADING
          ? { ...m, status: MESSAGE_STATUS.STOPPED, thinking: false }
          : m,
      ),
    );
  }, []);

  const retry = useCallback(
    (msgId: number) => {
      const idx = messages.findIndex((m) => m.id === msgId);
      if (idx < 1) return;
      const userMsg = messages[idx - 1];
      if (userMsg?.role !== CHAT_ROLES.USER) return;

      setMessages((prev) => prev.slice(0, idx));
      sendMessage(userMsg.content);
    },
    [messages, sendMessage],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    isSending,
    sessionId,
    mode,
    setMode,
    sendMessage,
    stopGenerate,
    retry,
    clearMessages,
  };
}

async function mockStreamResponse(prompt: string, mode: string): Promise<string> {
  return new Promise((resolve) => {
    const modeLabels: Record<string, string> = {
      brainstorm: '头脑风暴',
      analyze: '深度分析',
      create: '创意生成',
      evaluate: '方案评估',
    };

    const responses: Record<string, string> = {
      brainstorm: `针对「${prompt}」这个方向，我为你整理了以下几个创意维度：

**1. 跨界融合思路**
将不同领域的成熟方法论引入你的场景，往往能碰撞出意想不到的火花。比如把游戏化的激励机制引入产品设计。

**2. 反向思考法**
从目标用户最不满意的点出发，每个痛点都可能是一个创新突破口。

**3. 趋势叠加**
结合当前 AI + 大数据的技术趋势，思考如何用新技术重新定义旧问题。

这些方向中，你对哪个更感兴趣？我们可以深入探讨。`,
      analyze: `关于「${prompt}」，我从以下几个维度进行深度分析：

**市场环境**
当前市场规模持续增长，竞争格局呈现集中化趋势，头部玩家占据约 60% 市场份额。

**用户需求**
核心用户群体主要集中在 25-35 岁，核心诉求是效率提升和体验优化。

**技术可行性**
现有技术栈可以支撑，但需要在性能和成本之间做平衡。建议优先 MVP 验证核心假设。

需要针对某个维度做更深入的分析吗？`,
      create: `根据你的需求「${prompt}」，我为你生成了以下方案框架：

**一、项目概述**
明确项目定位、目标用户与核心价值主张。

**二、产品方案**
- 核心功能模块拆解
- 用户旅程地图
- MVP 功能优先级排序

**三、落地方案**
- 分阶段实施计划（3个月/6个月/12个月）
- 关键里程碑与交付物
- 资源需求与风险预案

这个框架可以作为后续深入讨论的基础，你觉得哪些部分需要细化？`,
      evaluate: `针对「${prompt}」，以下是评估结果：

**综合评分：8.2/10**

**优势（Strengths）**
- 需求真实存在，市场验证充分
- 技术方案可行性强
- 差异化优势明显

**风险（Risks）**
- 窗口期约 6-9 个月
- 需要持续的资源投入
- 竞品反应需要关注

**建议**
建议优先推进 MVP，在 3 个月内完成核心功能验证，根据数据反馈再决定是否加大投入。`,
    };

    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      resolve(responses[mode] || responses.brainstorm);
    }, delay);
  });
}
