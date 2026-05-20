import { useState, useCallback, useRef } from 'react';

// ====== 类型定义 ======
export interface InsightData {
  label: string;
  title: string;
  body: string;
  evidence: string[];
}

export interface ActionItem {
  title: string;
  desc: string;
  risk: string;
  potential: string;
}

export interface ActionData {
  label: string;
  items: ActionItem[];
}

export interface ChatMessage {
  id: string;
  content: string;
  isUser: boolean;
  type: 'text' | 'insight' | 'action';
  insightData?: InsightData;
  actionData?: ActionData;
  timestamp: number;
}

export interface ConversationStep {
  agent: string;
  options?: string[];
  type?: 'insight' | 'action';
  insightData?: InsightData;
  actionData?: ActionData;
  nextPhase?: number;
}

// ====== 阶段常量 ======
const PHASE_NAMES = ['破冰', '探索', '澄清', '洞察', '锚定'];
const PHASE_LABELS = [
  '阶段 1/5 · 破冰',
  '阶段 2/5 · 探索',
  '阶段 3/5 · 澄清',
  '阶段 4/5 · 洞察',
  '阶段 5/5 · 锚定',
];

// ====== 对话脚本 ======
const CONVERSATION: ConversationStep[] = [
  // Phase 0: 破冰 (steps 0-2)
  {
    agent: '嗨，我是你的创路伙伴 🤝\n\n听说你在想创业的事？跟我聊聊，你现在什么情况？',
    options: ['我在互联网公司做了好几年，想试试创业', '我有个模糊的想法，但说不清楚', '我不确定要不要创业，只是有这个念头'],
    nextPhase: 0,
  },
  {
    agent: '8年程序员，年薪50万——说实话，这已经是很多人羡慕的位置了。\n\n但你觉得不够？是哪里让你不舒服？',
    options: ['升职看不到希望', '感觉自己能力被浪费了', '不想一直给别人打工'],
    nextPhase: 0,
  },
  {
    agent: '升职无望的感觉我理解。每天做着重复的事，看着天花板就在那里，但够不到。\n\n那你有想过具体做什么方向吗？还是只是「想创业」这个念头？',
    options: ['有个大概方向，但没想清楚', '没方向，只是想出去闯闯', '说实话，我连该不该创业都不确定'],
    nextPhase: 1,
  },

  // Phase 1: 探索 (steps 3-6)
  {
    agent: '不确定也没关系。很多人说想创业，但真正需要的未必是「创业」这件事。\n\n我换个角度问你——你每天工作之外，最喜欢做什么？',
    options: ['研究新技术、新科技', '看商业案例和创业故事', '跟朋友聊想法和趋势'],
    nextPhase: 1,
  },
  {
    agent: '你说喜欢研究新科技——那你研究的时候，是更享受「搞懂一个技术」本身，还是更享受「用这个技术做个产品出来」？\n\n这两个其实差别很大。',
    options: ['更享受搞懂技术本身', '更享受做出产品', '两者都享受，但更偏技术'],
    nextPhase: 1,
  },
  {
    agent: '这很关键。你本质上是一个「深度钻研者」。\n\n那我再问一个可能不太舒服的问题——你怕创业失败，最怕的是什么？',
    options: ['怕经济上扛不住', '怕发现自己其实没有商业能力', '怕回去找不到现在这样的工作'],
    nextPhase: 1,
  },
  {
    agent: '怕回去找不到好工作……这个恐惧背后，其实是在说：你现在的生活是有安全网的，你不愿失去它。\n\n但另一个角度——你老婆支持你创业。这个支持到什么程度？',
    options: ['精神上支持，经济上不能冒险', '全力支持，包括经济', '她支持，但我也不能辜负她的信任'],
    nextPhase: 2,
  },

  // Phase 2: 澄清 (steps 7-9)
  {
    agent: '我听到一个有意思的矛盾——\n\n你说想创业，但你最享受的是研究技术本身；你怕失败，但你老婆支持你。你刷创业公众号越看越迷茫，可能是因为那些故事里没有你这个类型的人。',
    options: ['……好像是这么回事', '我不太确定你的意思', '继续说'],
    nextPhase: 2,
  },
  {
    agent: '你每天晚上刷创业文章越看越迷茫——因为你潜意识里知道，那些「融资千万」「快速做大」的路径不是你要的。你要的其实是：\n\n一种不受组织天花板限制的、能持续成长的方式。',
    options: ['对，是这样的', '有道理，但我不完全确定', '我想再想想'],
    nextPhase: 2,
  },
  {
    agent: '而且你害怕的不是创业本身——你害怕的是：离开安全网之后，发现自己其实不适合做商业。\n\n这个恐惧，恰恰说明你对自己是有清醒认知的。这不是弱点，这是你的优势。',
    options: ['你说得对，我确实一直有这种感觉', '我需要消化一下', '继续'],
    nextPhase: 3,
  },

  // Phase 3: 洞察 (step 10 - insight card)
  {
    agent: '让我帮你把刚才聊的串起来——',
    type: 'insight',
    insightData: {
      label: '💡 方向洞察',
      title: '你不是一个「创业者」，\n你是一个「深度技术专家」。',
      body: '你真正渴望的不是一家公司，而是不受组织天花板限制的技术影响力。',
      evidence: [
        '8年深耕技术，享受钻研过程本身',
        '对商业运作没有内驱力，刷创业文章越看越迷茫',
        '核心恐惧是「失去安全网后发现自己不行」',
        '真正想要的是「自主成长空间」，而非「创业标签」',
      ],
    },
    nextPhase: 3,
  },

  // Phase 4: 锚定 (steps 11-12)
  {
    agent: '既然你的方向是「深度技术专家」而不是「创业者」，那问题就变成了——\n\n怎么在不离开安全网的情况下，先扩大你的技术影响力？',
    type: 'action',
    actionData: {
      label: '🎯 行动建议',
      items: [
        { title: '1. 技术内容输出', desc: '把你的技术研究变成博客/视频，建立行业影响力', risk: '⭐', potential: '⭐⭐⭐' },
        { title: '2. 开源项目深耕', desc: '在GitHub维护一个有价值的项目，成为领域专家', risk: '⭐', potential: '⭐⭐' },
        { title: '3. 技术专家路线升级', desc: '跳槽到更重视技术深度的公司，走专家通道', risk: '⭐⭐', potential: '⭐⭐' },
      ],
    },
    nextPhase: 4,
  },
  {
    agent: '这三个方向都不需要你立刻辞职冒险。你可以先在下班后试水，感受一下哪个让你更有能量。\n\n记住：你不需要成为「创业者」才能自由成长。找到适合你的路径，比套用一个标签重要得多 💪',
    options: ['我想深入聊聊第一个方向', '我想继续探索其他可能性', '谢谢，我需要时间想想'],
    nextPhase: 4,
  },
];

let msgIdCounter = 0;
function nextId() {
  return `msg_${++msgIdCounter}_${Date.now()}`;
}

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const chatStepRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const phaseName = PHASE_NAMES[currentPhase] + '中';
  const phaseLabel = PHASE_LABELS[currentPhase];

  const addMessage = useCallback(
    (content: string, isUser: boolean, type: ChatMessage['type'] = 'text', extra?: Partial<ChatMessage>) => {
      const msg: ChatMessage = {
        id: nextId(),
        content,
        isUser,
        type,
        timestamp: Date.now(),
        ...extra,
      };
      setMessages((prev) => [...prev, msg]);
    },
    []
  );

  const playStep = useCallback(() => {
    const step = CONVERSATION[chatStepRef.current];
    if (!step) return;

    // 更新阶段
    if (step.nextPhase !== undefined && step.nextPhase !== currentPhase) {
      setCurrentPhase(step.nextPhase);
    }

    setIsTyping(true);
    setQuickReplies([]);

    const delay = Math.min(800 + step.agent.length * 15, 2500);

    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      addMessage(step.agent, false, step.type || 'text', {
        insightData: step.insightData,
        actionData: step.actionData,
      });

      if (step.options) {
        setTimeout(() => {
          setQuickReplies([...step.options!, '✍️ 我想自己说']);
        }, step.type ? 1200 : 500);
      }
    }, delay);
  }, [addMessage, currentPhase]);

  const startChat = useCallback(() => {
    setStarted(true);
    chatStepRef.current = 0;
    playStep();
  }, [playStep]);

  const selectQuickReply = useCallback(
    (text: string) => {
      if (text === '✍️ 我想自己说') {
        setQuickReplies([]);
        return;
      }
      addMessage(text, true);
      setQuickReplies([]);
      chatStepRef.current++;
      setTimeout(() => playStep(), 600);
    },
    [addMessage, playStep]
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isTyping) return;
      addMessage(text.trim(), true);
      setQuickReplies([]);
      chatStepRef.current++;
      if (chatStepRef.current < CONVERSATION.length) {
        setTimeout(() => playStep(), 600);
      } else {
        setTimeout(() => {
          addMessage('任何时候想继续聊，我都在这里 🤝', false);
        }, 1000);
      }
    },
    [addMessage, isTyping, playStep]
  );

  const acceptInsight = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.type === 'insight'
            ? { ...m, insightData: { ...m.insightData!, accepted: true as any } }
            : m
        )
      );
      chatStepRef.current++;
      setTimeout(() => playStep(), 1000);
    },
    [playStep]
  );

  const reviseInsight = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.type === 'insight'
            ? { ...m, insightData: { ...m.insightData!, revised: true as any } }
            : m
        )
      );
      addMessage('部分对，让我再说说……', true);
      chatStepRef.current++;
      setTimeout(() => playStep(), 800);
    },
    [addMessage, playStep]
  );

  const selectAction = useCallback(
    (title: string) => {
      addMessage(title + '，我想深入了解一下', true);
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        addMessage(
          '很好的选择！这个方向最大的优势是：你不需要辞职就能开始。\n\n你可以每周投入5-10小时，先建立你的技术内容体系。3个月后回看，你会发现自己的影响力已经在悄悄增长。\n\n要不要我把具体的起步计划整理给你？',
          false
        );
      }, 1500);
    },
    [addMessage]
  );

  const resetChat = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    chatStepRef.current = 0;
    setCurrentPhase(0);
    setMessages([]);
    setQuickReplies([]);
    setIsTyping(false);
    setStarted(true);
    playStep();
  }, [playStep]);

  return {
    messages,
    currentPhase,
    isTyping,
    quickReplies,
    started,
    phaseName,
    phaseLabel,
    startChat,
    selectQuickReply,
    sendMessage,
    acceptInsight,
    reviseInsight,
    selectAction,
    resetChat,
  };
}
