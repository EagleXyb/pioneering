/**
 * 聊天消息类型（阶段 4.1 平地化）
 *
 * 结构与字段名保持与 tdesign-web-components chat-engine 完全一致，
 * 从 types/tdesign.ts 深拷贝而来，业务代码（store/hooks/转换器/组件）
 * 无需改动即可无感切换；TDesign 全家移除后本文件成为唯一消息类型源。
 */

export type ChatMessageRole = 'user' | 'assistant' | 'system';
export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'stop'
  | 'error';
/** 会话级状态：idle 空闲 / pending 等待首帧 / streaming 流式中 / complete 完成 / error 失败 */
export type ChatStatus = 'idle' | ChatMessageStatus;

export type ChatContentType =
  | 'text'
  | 'markdown'
  | 'search'
  | 'attachment'
  | 'thinking'
  | 'image'
  | 'audio'
  | 'video'
  | 'suggestion'
  | 'reasoning'
  | 'toolcall'
  | 'activity';

export interface ChatBaseContent<T extends string, TData> {
  type: T;
  data: TData;
  status?: ChatMessageStatus;
  id?: string;
  strategy?: 'merge' | 'append';
  ext?: Record<string, any>;
}

export type TextContent = ChatBaseContent<'text', string>;
export type MarkdownContent = ChatBaseContent<'markdown', string>;

export type ImageContent = ChatBaseContent<
  'image',
  {
    name?: string;
    url?: string;
    width?: number;
    height?: number;
  }
>;

export type ReferenceItem = {
  title: string;
  icon?: string;
  type?: string;
  url?: string;
  content?: string;
  site?: string;
  date?: string;
};

export type SearchContent = ChatBaseContent<
  'search',
  {
    title?: string;
    references?: ReferenceItem[];
  }
>;

export type SuggestionItem = {
  title: string;
  prompt?: string;
};

export type SuggestionContent = ChatBaseContent<
  'suggestion',
  SuggestionItem[]
>;

/** reasoning 的 data 是一组 AIMessageContent（text/markdown 片段） */
export type ReasoningContent = ChatBaseContent<'reasoning', AIMessageContent[]>;

export type AttachmentType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'doc'
  | 'ppt'
  | 'txt';

export type AttachmentItem = {
  fileType: AttachmentType;
  size?: number;
  name?: string;
  url?: string;
  isReference?: boolean;
  width?: number;
  height?: number;
  extension?: string;
  metadata?: Record<string, any>;
};

export type AttachmentContent = ChatBaseContent<
  'attachment',
  AttachmentItem[]
>;

export type ThinkingContent = ChatBaseContent<
  'thinking',
  {
    text?: string;
    title?: string;
  }
>;

export type ToolCall = {
  toolCallId: string;
  toolCallName: string;
  eventType?: string;
  parentMessageId?: string;
  args?: string;
  chunk?: string;
  result?: string;
};

export type ToolCallContent = ChatBaseContent<'toolcall', ToolCall>;

export type ActivityData<TContent = Record<string, any>> = {
  activityType: string;
  messageId?: string;
  content: TContent;
  deltaInfo?: {
    fromIndex: number;
    toIndex: number;
  };
};

export type ActivityContent<TContent = Record<string, any>> = ChatBaseContent<
  'activity',
  ActivityData<TContent>
>;

export interface ChatBaseMessage {
  id: string;
  status?: ChatMessageStatus;
  datetime?: string;
  ext?: any;
}

type AIContentTypeMap = {
  text: TextContent;
  markdown: MarkdownContent;
  thinking: ThinkingContent;
  image: ImageContent;
  search: SearchContent;
  suggestion: SuggestionContent;
  reasoning: ReasoningContent;
  toolcall: ToolCallContent;
  activity: ActivityContent;
};

export type AIContentType = keyof AIContentTypeMap;
export type AIMessageContent = AIContentTypeMap[AIContentType];

export type UserMessageContent = TextContent | AttachmentContent;

export interface UserMessage extends ChatBaseMessage {
  role: 'user';
  content: UserMessageContent[];
}

/** 消息反馈评论：good 赞 / bad 踩 / '' 无 */
export type ChatComment = 'good' | 'bad' | '';

export interface AIMessage extends ChatBaseMessage {
  role: 'assistant';
  content?: AIMessageContent[];
  history?: AIMessageContent[][];
  comment?: ChatComment;
}

export interface SystemMessage extends ChatBaseMessage {
  role: 'system';
  content: TextContent[];
}

export type ChatMessagesData = UserMessage | AIMessage | SystemMessage;

/** 操作栏动作名（与原 TdChatActionsName 一致） */
export type TdChatActionsName = 'copy' | 'good' | 'bad' | 'replay' | 'share';
