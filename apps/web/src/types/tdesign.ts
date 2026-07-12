/**
 * TDesign Chat 类型集中 re-export
 *
 * 将对 `tdesign-web-components`（@tdesign-react/chat 的传递依赖）的 deep import
 * 收敛到本文件，避免源码各处直接依赖未在 package.json 中声明的包。
 * 升级 @tdesign-react/chat 时只需修改本文件。
 */
export type { ChatMessagesData, ChatStatus, ChatComment } from 'tdesign-web-components/lib/chat-engine';
export type { TdChatActionsName } from 'tdesign-web-components/lib/chat-action';
