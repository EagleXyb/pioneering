/**
 * 本地临时消息 id → 后端真实 id 对齐
 *
 * 背景：三个模式在流式发送时都会先在本地造一条消息（chat 用 `u_<ts>` / `a_<ts>`，
 * pro/task 同构），而"编辑重发"必须携带后端真实的消息 id（`msg_*`），
 * 否则 PUT/POST 会因主键不存在而 404。
 *
 * 策略（安全优先，宁可解析失败也不允许错配）：
 *   1. 拉取会话历史（后端真实 id）
 *   2. 从**尾部向前**对每条本地临时 id 消息做单调回溯匹配，
 *      匹配条件为 (role, 文本) 完全一致；每条历史消息最多被使用一次
 *   3. 匹配不上就不写入映射，由调用方提示用户刷新后重试
 *
 * 不做"按下标对齐"的原因：本地列表可能含有未持久化的消息
 * （HITL 暂停占位 `assistant-hitl-*`、流式占位等），按位对齐会整体错位一位，
 * 从而把 A 消息的 id 安到 B 消息上——这类错配会静默改错数据。
 */
import { getMessages } from '../api/message';

/** 仅匹配本地乐观生成的临时 id，不触碰后端真实 id */
const LOCAL_ID_RE = /^[ua]_\d+$/;

export function isLocalMessageId(id: string): boolean {
  return LOCAL_ID_RE.test(id);
}

interface MessageLike {
  id: string;
  role: string;
  content?: Array<{ type?: string; data?: unknown }> | undefined;
}

/** 拼接 text/markdown 片段为纯文本（与 converter / 用户气泡口径一致） */
function extractTextBlocks(content: MessageLike['content']): string {
  return (content ?? [])
    .filter((c) => c?.type === 'text' || c?.type === 'markdown')
    .map((c) => (typeof c?.data === 'string' ? c.data : ''))
    .join('\n');
}

/**
 * 解析本地临时 id 到后端真实 id 的映射。
 *
 * @returns localId → realId；无法解析的条目不包含在返回值中
 */
export async function resolveLocalMessageIds(
  sessionId: string | null,
  localMessages: ReadonlyArray<MessageLike>,
  limit = 100,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!sessionId || sessionId.startsWith('temp_')) return map;
  if (!localMessages.some((m) => isLocalMessageId(m.id))) return map;

  let remote: Array<{ id: string; role: string; content: string }>;
  try {
    const resp = await getMessages(sessionId, undefined, limit, 'before');
    remote = resp.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ id: m.id, role: m.role, content: m.content ?? '' }));
  } catch {
    // 历史拉取失败：不阻断编辑流程，由调用方提示"无法定位"
    return map;
  }

  let j = remote.length - 1;
  for (let i = localMessages.length - 1; i >= 0; i--) {
    const local = localMessages[i];
    if (!isLocalMessageId(local.id)) continue;

    const text = extractTextBlocks(local.content);
    // 单调回溯：j 只向前移动，保证一条远端消息不会被两条本地消息复用
    while (j >= 0 && !(remote[j].role === local.role && remote[j].content === text)) {
      j--;
    }
    if (j < 0) break; // 更早的本地消息也不可能匹配到（远端已耗尽）
    map.set(local.id, remote[j].id);
    j--;
  }

  return map;
}
