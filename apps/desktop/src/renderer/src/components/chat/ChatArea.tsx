// ============================================================
// ChatArea — 中栏对话区（消息流 + 输入框）
// ============================================================
//
// 收敛说明（原 T10/T11/T12/T13/T14 feature flag 已移除）：
//   - 消息列表统一使用 MessageScrollerList（@shadcn/react + content-visibility）
//   - legacy ScrollArea + MessageList（虚拟化 + isNearBottomRef）已删除
//   - 流式自动跟随由 MessageScrollerProvider.autoScroll 接管
//   - 滚动感知顶部栏的逻辑保留，统一查询 message-scroller-viewport
//
// 布局模式：
//   - 欢迎页模式（showWelcome=true）：整体垂直居中，InputArea 随欢迎内容流居中
//   - 聊天模式（showWelcome=false）：三段式——消息区 flex-1 overflow / AgentStatus / InputArea
// ============================================================

import { useRef, useEffect, useMemo, useCallback, useState, createElement } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { chatScrolledAtom, chatWelcomeModeAtom } from '@/stores/atoms'
import { MessageScrollerList } from './MessageScrollerList'
import { WelcomeScreenTop, WelcomeScreenBottom } from './WelcomeScreen'
import { InputArea, type InputAreaSendOptions } from './input/InputArea'
import { AgentStatus } from './ChatStatus'
// P1：图片放大预览（Portal 全局单例，关闭时渲染 null，不影响布局）
import { ImageLightbox } from './ImageLightbox'
import { selectIsHitlPaused, useChatStore } from '../../stores/chatStore'
import { useHitlStore } from '@/stores/hitlStore'
import { useFeatureFlag } from '@/lib/feature-flags'
import type { Message } from '@shared/types'
import type { ImageAttachment } from '@/lib/input/image-attachments'
// T09：dev-only 压测 mock 数据（仅 DEV 环境打包）
import { generateStressMessages, STRESS_SESSION_PREFIX } from '@/lib/dev/stress-messages'

export function ChatArea() {
  // 逐项选择器订阅，避免全量重渲染（流式期间仅 streaming* 触发重渲染）
  const sessionsLength = useChatStore((s) => s.sessions.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const messages = useChatStore((s) => s.messages)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingThinking = useChatStore((s) => s.streamingThinking)
  const streamingToolCalls = useChatStore((s) => s.streamingToolCalls)
  const streamingTraceNodes = useChatStore((s) => s.streamingTraceNodes)
  const streamingTraceRootOrder = useChatStore((s) => s.streamingTraceRootOrder)
  const streamingMessageId = useChatStore((s) => s.streamingMessageId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const agentMode = useChatStore((s) => s.agentMode)
  const setAgentMode = useChatStore((s) => s.setAgentMode)
  // T10：Composer 计划模式（新会话 plan_execute）
  const planMode = useChatStore((s) => s.planMode)
  const setPlanMode = useChatStore((s) => s.setPlanMode)
  const error = useChatStore((s) => s.error)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopStreaming = useChatStore((s) => s.stopStreaming)
  const clearError = useChatStore((s) => s.clearError)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const loadMoreMessages = useChatStore((s) => s.loadMoreMessages)
  const messagesHasMore = useChatStore((s) => s.messagesHasMore)
  const messagesLoading = useChatStore((s) => s.messagesLoading)
  // 阶段三 3.4：HITL 暂停态输入区切精简态（按会话判定，避免跨会话串线）
  const isHitlPaused = useChatStore(selectIsHitlPaused)
  // HITL 待答复项（仅当前会话）：用于内联澄清条与输入框提交语义切换
  const hitlItem = useHitlStore((s) =>
    s.currentItem && s.currentItem.sessionId === currentSessionId ? s.currentItem : null
  )
  const hitlQueueLength = useHitlStore((s) => s.pendingQueue.length)
  const hitlError = useHitlStore((s) => s.error)
  const resolveHitl = useHitlStore((s) => s.resolve)
  const skipHitl = useHitlStore((s) => s.skip)
  const dismissHitl = useHitlStore((s) => s.dismiss)

  // T09：dev-only 压测开关
  const devStress = useFeatureFlag('devStressMessages')
  const devStressCount = useFeatureFlag('devStressCount')

  // 消息区容器 ref：用于定位滚动容器，驱动顶部栏下边框显隐
  const messagesPaneRef = useRef<HTMLDivElement>(null)

  // 滚动感知顶部栏：消息区滚动离开顶部（scrollTop > 0）时，
  // ChatHeader 显示下边框；回到顶部/无滚动容器（欢迎页、内容不足一屏）时隐藏。
  const setChatScrolled = useSetAtom(chatScrolledAtom)

  // 欢迎页模式状态：同步到 chatWelcomeModeAtom 供 RootLayout 隐藏顶部栏
  const setChatWelcomeMode = useSetAtom(chatWelcomeModeAtom)

  // 欢迎页功能标签选中态（Top 组件切换时同步给 Bottom 组件）
  const [welcomeFeature, setWelcomeFeature] = useState('doc')

  const realMessages: Message[] = currentSessionId ? messages[currentSessionId] || [] : []
  const hasMore = currentSessionId ? !!messagesHasMore[currentSessionId] : false
  const isLoadingMore = messagesLoading && realMessages.length > 0

  // T09：dev 压测时注入大量 mock 消息（仅 dev，且用 __stress__ 前缀隔离）
  const currentMessages: Message[] = useMemo(() => {
    if (import.meta.env.DEV && devStress && currentSessionId) {
      const stressSessionId = STRESS_SESSION_PREFIX + currentSessionId
      return generateStressMessages(devStressCount, stressSessionId)
    }
    return realMessages
  }, [realMessages, devStress, devStressCount, currentSessionId])

  useEffect(() => {
    if (sessionsLength === 0) {
      loadSessions()
    }
  }, [sessionsLength, loadSessions])

  const handleSend = (
    content: string,
    images?: ImageAttachment[],
    options?: InputAreaSendOptions
  ) => {
    void sendMessage(content, {
      images: images ?? [],
      selectedFiles: options?.selectedFiles,
      skill: options?.skill,
      model: options?.model
    })
  }

  // WelcomeScreen 快捷提示词点击：直接发送
  const handleQuickPrompt = useCallback(
    (text: string) => {
      void sendMessage(text, { images: [] })
    },
    [sendMessage]
  )

  // ===== HITL 内嵌卡（澄清/多选/工具审批统一在输入框上方承接）=====
  const hitlTotal = hitlItem ? 1 + hitlQueueLength : 0
  const hitlInput = useMemo(
    () =>
      hitlItem
        ? {
            kind: hitlItem.kind,
            question: hitlItem.question,
            message: hitlItem.message,
            options: hitlItem.options,
            artifacts: hitlItem.artifacts,
            toolCalls: hitlItem.toolCalls,
            index: hitlTotal > 1 ? 1 : undefined,
            total: hitlTotal > 1 ? hitlTotal : undefined
          }
        : null,
    [hitlItem, hitlTotal]
  )
  // 内联提交：文本作为澄清回答回传（同时写入 feedback，兼容只读 feedback 的后端）
  const handleHitlAnswer = useCallback(
    (text: string) => {
      void resolveHitl({ approved: true, answer: text, feedback: text })
    },
    [resolveHitl]
  )
  // 点选候选选项：以 answerId 回传（后端 clarify 节点按 id 匹配选项 label 注入下游）
  const handleHitlSelectOption = useCallback(
    (optionId: string) => {
      void resolveHitl({ approved: true, answerId: optionId })
    },
    [resolveHitl]
  )
  const handleHitlSkip = useCallback(() => {
    void skipHitl()
  }, [skipHitl])
  // 工具审批-批准：可携带按 tool_call_id 覆盖的修改参数（解析失败的项由 store 忽略）
  const handleHitlApprove = useCallback(
    (modifiedArgs: Record<string, Record<string, unknown>> | null) =>
      resolveHitl({ approved: true, modifiedArgs }),
    [resolveHitl]
  )
  // 工具审批-拒绝：以 approved=false 恢复，图继续走"拒绝"分支（不等同中止）
  const handleHitlReject = useCallback(
    () => resolveHitl({ approved: false, feedback: '用户拒绝了该工具调用' }),
    [resolveHitl]
  )
  // 工具审批-取消：放弃整个 run（等价旧模态弹窗的点遮罩/ESC 关闭 → abort）
  const handleHitlDismiss = useCallback(() => {
    dismissHitl()
  }, [dismissHitl])
  // 方案确认门-执行此方案：批准并继续（后端 plan_confirm 节点尚未接入，当前协议预留）
  const handleHitlConfirmPlan = useCallback(() => {
    void resolveHitl({ approved: true })
  }, [resolveHitl])

  // 是否显示欢迎引导页（无消息且非流式状态）
  const showWelcome = currentMessages.length === 0 && !isStreaming && !streamingContent

  // 同步欢迎页模式到 atom，供 RootLayout 控制顶部栏显隐
  useEffect(() => {
    setChatWelcomeMode(showWelcome)
    return () => setChatWelcomeMode(false)
  }, [showWelcome, setChatWelcomeMode])

  // 滚动感知顶部栏：消息区滚动离开顶部（scrollTop > 0）时，
  // ChatHeader 显示下边框；回到顶部/无滚动容器（欢迎页、内容不足一屏）时隐藏。
  useEffect(() => {
    if (showWelcome) {
      setChatScrolled(false)
      return
    }
    const pane = messagesPaneRef.current
    if (!pane) return
    const container = pane.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"]'
    )
    if (!container) {
      setChatScrolled(false)
      return
    }
    const update = () => setChatScrolled(container.scrollTop > 0)
    update()
    container.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      container.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [showWelcome, currentSessionId, currentMessages.length, setChatScrolled])

  // ============================================================
  // 欢迎页模式：整体垂直居中
  // 布局顺序对齐 TRAE 参考图：
  //   标题 → 功能标签 → 输入框 → 模板卡片
  // ============================================================
  if (showWelcome) {
    return (
      <div className="flex flex-col h-full bg-background overflow-y-auto">
        <div className="flex flex-col min-h-full w-full">
          {/* 上半弹性占位：把「标题+标签+输入框」推到窗口正中间 */}
          <div className="flex-1 min-h-0 shrink-0" />

          {/* 居中主体：「标题+标签+输入框」整体下移 20px（translate 不占布局空间）；
              推荐区仍按结构位置 pt-[116px]，视觉位置不变 */}
          <div
            className="w-full flex flex-col items-center"
            style={{
              // 欢迎页与输入区/消息区共享同一自适应列宽令牌（随窗口宽度变化）
              maxWidth: 'var(--chat-col-w)',
              paddingInline: 'var(--chat-col-pad)',
              marginInline: 'auto',
              paddingTop: 0,
              paddingBottom: 0,
              marginTop: -50,
              marginBottom: -50
            }}
          >
            {/* 层叠修复（欢迎页按钮点不动）：
                本区块固定 height 259 容纳不下「标题 + 输入框」（实际约需 278px），
                输入卡片底部工具栏（+ / 模型 / 发送）会溢出盒外，落入下方推荐区容器
                （marginTop -16 使其从 243 起，paddingTop 80 的透明空白区无 pointer-events 隔离）
                的层叠范围，被其拦截点击（视觉可见但点不动）。
                本区块与推荐区同为 flex item，z-index 对其直接生效，提升后即可修复。 */}
            <div
              className="w-full flex flex-col items-center gap-6 translate-y-[40px] relative z-10"
              style={{ height: 259, paddingTop: 0, paddingBottom: 25 }}
            >
              <WelcomeScreenTop onFeatureChange={setWelcomeFeature} />

              <div className="w-full">
                <InputArea
                  sessionId={currentSessionId}
                  onSend={handleSend}
                  onStop={stopStreaming}
                  isStreaming={isStreaming}
                  disabled={false}
                  agentMode={agentMode}
                  onToggleAgent={() => setAgentMode(!agentMode)}
                  planMode={planMode}
                  onTogglePlan={() => setPlanMode(!planMode)}
                  isWelcome={true}
                  mode={isHitlPaused ? 'hitl' : 'normal'}
                  hitl={hitlInput}
                  hitlError={hitlError}
                  onHitlAnswer={handleHitlAnswer}
                  onHitlSelectOption={handleHitlSelectOption}
                  onHitlSkip={handleHitlSkip}
                  onHitlApprove={handleHitlApprove}
                  onHitlReject={handleHitlReject}
                  onHitlDismiss={handleHitlDismiss}
                  onHitlConfirmPlan={handleHitlConfirmPlan}
                />
              </div>
            </div>

            {/* 推荐区：整体下移 20px —— 用 translate 而非 padding。
                上下 flex-1 垂直居中会均分吸收中间内容的高度变化（padding+20 只能下移 ~10px），
                translate 不占布局空间，可保证完整下移 20px（与上方标题块下移手法一致）。 */}
            <div
              className="w-full translate-y-5"
              style={{ paddingTop: 80, paddingBottom: 80, marginTop: -16, marginBottom: -16 }}
            >
              <WelcomeScreenBottom activeFeature={welcomeFeature} onQuickPrompt={handleQuickPrompt} />
            </div>
          </div>

          {/* 下半弹性占位：固定 110px 高度 */}
          <div className="w-full h-[110px]" />
        </div>

        {/* 错误提示条（欢迎态也可能出错，例如发消息失败） */}
        {createElement(AgentStatus, {
          toolCalls: streamingToolCalls,
          error,
          onClearError: clearError
        })}

        {/* P1：图片放大预览 Lightbox（Portal 挂载，关闭时不渲染任何 DOM） */}
        <ImageLightbox />
      </div>
    )
  }

  // ============================================================
  // 聊天模式：三段式——消息区 flex-1 / AgentStatus / InputArea
  // ============================================================
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages：与输入框同宽（由 --chat-col-w 自适应令牌统一约束）并居中 */}
      <div className="chat-messages-pane flex-1 overflow-hidden" ref={messagesPaneRef}>
        <div className="mx-auto h-full w-full max-w-[var(--chat-col-w)] px-0">
          <MessageScrollerList
            messages={currentMessages}
            streamingContent={streamingContent}
            streamingThinking={streamingThinking}
            streamingToolCalls={streamingToolCalls}
            streamingTraceNodes={streamingTraceNodes}
            streamingTraceRootOrder={streamingTraceRootOrder}
            streamingMessageId={streamingMessageId}
            isStreaming={isStreaming}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={loadMoreMessages}
          />
        </div>
      </div>

      {/* 错误提示条：仅出错时展示（运行态已内联于消息流），置于底部避免顶部 layout shift */}
      {createElement(AgentStatus, {
        toolCalls: streamingToolCalls,
        error,
        onClearError: clearError
      })}

      {/* Input */}
      <InputArea
        sessionId={currentSessionId}
        onSend={handleSend}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={false}
        agentMode={agentMode}
        onToggleAgent={() => setAgentMode(!agentMode)}
        planMode={planMode}
        onTogglePlan={() => setPlanMode(!planMode)}
        isWelcome={false}
        mode={isHitlPaused ? 'hitl' : 'normal'}
        hitl={hitlInput}
        hitlError={hitlError}
        onHitlAnswer={handleHitlAnswer}
        onHitlSelectOption={handleHitlSelectOption}
        onHitlSkip={handleHitlSkip}
        onHitlApprove={handleHitlApprove}
        onHitlReject={handleHitlReject}
        onHitlDismiss={handleHitlDismiss}
        onHitlConfirmPlan={handleHitlConfirmPlan}
      />

      {/* P1：图片放大预览 Lightbox（Portal 挂载，关闭时不渲染任何 DOM） */}
      <ImageLightbox />
    </div>
  )
}
