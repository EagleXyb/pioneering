import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 任务模式输入框逻辑 Hook
 *
 * 设计参考：apps/web/docs/输入框实现深度分析.md
 *   - §2.4 草稿持久化（sessionStorage + debounce + chatId 隔离）
 *   - §3.2 / §3.6 IME 合成态感知的 Enter 提交（兼容 Safari iOS compositionend 与 keydown 同时触发）
 *   - §3.5 autosize：重置高度 → 读 scrollHeight → 写回，并保存/恢复祖先滚动位置避免页面跳动
 *   - §4.1 提交前校验（流式态/空内容）
 *
 * 与组件职责分离：本 Hook 只关心状态与事件处理，UI 渲染交给 TaskInput.tsx。
 */

const MAX_DRAFT_LENGTH = 5000;
const DRAFT_SAVE_DEBOUNCE_MS = 500;
const TEXTAREA_MAX_HEIGHT = 200;
const TEXTAREA_MIN_HEIGHT = 44;

/** Safari iOS 检测：compositionend 与 Enter keydown 会同时触发，需要时间戳二次校验 */
const isSafari =
  typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

interface AppPrefs {
  /** false 时需 Ctrl/Cmd + Enter 发送（与 SettingsDialog 中的偏好一致） */
  enterToSend: boolean;
}

const DEFAULT_PREFS: AppPrefs = { enterToSend: true };

/** 读取全局应用偏好（键名与 SettingsDialog 保持一致） */
function readPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem('app:preferences');
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enterToSend:
        typeof parsed.enterToSend === 'boolean' ? parsed.enterToSend : true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface UseTaskInputOptions {
  /** 当前会话 ID，用于草稿隔离；为 null 时不持久化 */
  chatId: string | null;
  /** 是否处于流式输出中 */
  isStreaming: boolean;
  /** 发送回调 */
  onSend: (text: string) => void;
  /** 停止回调（用于 Escape 键） */
  onStop: () => void;
}

export function useTaskInput({
  chatId,
  isStreaming,
  onSend,
  onStop,
}: UseTaskInputOptions) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // IME 合成态：单纯 isComposing 在 Safari iOS 上会漏判（compositionend 与 Enter keydown 同时触发）
  // 用时间戳做二次校验：compositionend 后 500ms 内的 Enter 视为合成确认，忽略
  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(-Infinity);

  // 草稿保存计时器
  const saveDraftTimerRef = useRef<number | null>(null);

  // 应用偏好（仅在挂载时读取一次；用户在设置中切换后需刷新生效，符合现有项目模式）
  const prefs = useMemo(readPrefs, []);

  const draftKey = chatId ? `task-input-draft-${chatId}` : null;

  // ---- 草稿加载：chatId 变化时从 sessionStorage 恢复 ----
  useEffect(() => {
    if (!draftKey) {
      setValue('');
      return;
    }
    try {
      setValue(sessionStorage.getItem(draftKey) ?? '');
    } catch {
      setValue('');
    }
  }, [draftKey]);

  // ---- 草稿保存：value 变化时防抖写入 sessionStorage ----
  useEffect(() => {
    if (!draftKey) return;
    if (saveDraftTimerRef.current) {
      window.clearTimeout(saveDraftTimerRef.current);
    }
    // 空内容直接清掉，避免遗留空草稿
    if (!value) {
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore quota errors */
      }
      return;
    }
    if (value.length > MAX_DRAFT_LENGTH) return;
    saveDraftTimerRef.current = window.setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, value);
      } catch {
        /* ignore quota errors */
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveDraftTimerRef.current) {
        window.clearTimeout(saveDraftTimerRef.current);
        saveDraftTimerRef.current = null;
      }
    };
  }, [value, draftKey]);

  // ---- 自动增高：保存/恢复祖先滚动位置避免页面跳动 ----
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    // 1. 记录所有已滚动祖先的 scrollTop（读 scrollTop 不会触发 reflow）
    const scrolledAncestors: Array<{ el: HTMLElement; top: number }> = [];
    let p: Node | null = el.parentNode;
    while (p && p !== document.body) {
      if (p instanceof HTMLElement && p.scrollTop > 0) {
        scrolledAncestors.push({ el: p, top: p.scrollTop });
      }
      p = p.parentNode;
    }
    const windowScrollY = window.scrollY;

    // 2. 重置高度 → 读 scrollHeight → 写回（带 min/max 限制）
    el.style.height = '';
    let height = el.scrollHeight;
    if (height < TEXTAREA_MIN_HEIGHT) height = TEXTAREA_MIN_HEIGHT;
    if (height > TEXTAREA_MAX_HEIGHT) height = TEXTAREA_MAX_HEIGHT;
    el.style.height = `${height}px`;

    // 3. 恢复被布局变动影响的祖先 scroll
    scrolledAncestors.forEach(({ el: ancestor, top }) => {
      if (ancestor.scrollTop !== top) ancestor.scrollTop = top;
    });
    if (window.scrollY !== windowScrollY) {
      window.scrollTo(window.scrollX, windowScrollY);
    }
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  // ---- 挂载后自动聚焦（延迟一帧，避免与首次渲染的 scroll 校正冲突） ----
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // ---- IME 合成态 ----
  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      compositionEndedAtRef.current = e.timeStamp;
      isComposingRef.current = false;
    },
    [],
  );

  /**
   * 判定按键是否处于 IME 合成态
   * - isComposing=true：合成中，忽略 Enter
   * - Safari iOS：compositionend 与 keydown 同时触发，500ms 内的 Enter 视为合成确认
   */
  const inOrNearComposition = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return true;
      if (isSafari && Math.abs(e.timeStamp - compositionEndedAtRef.current) < 500) {
        compositionEndedAtRef.current = -Infinity;
        return true;
      }
      return false;
    },
    [],
  );

  // ---- 发送 ----
  const handleSend = useCallback(() => {
    // 防御性校验：流式态/空内容拒绝发送（即使按钮已 disabled，键盘路径仍可能触达）
    if (isStreaming) return;
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue('');
    // 立即清空草稿，避免下一帧防抖又把空字符串写入前残留
    if (draftKey) {
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    }
  }, [value, isStreaming, onSend, draftKey]);

  // ---- 键盘事件 ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape：流式输出中允许按 Escape 停止
      if (e.key === 'Escape') {
        if (isStreaming) {
          e.preventDefault();
          onStop();
        }
        return;
      }

      // Enter 提交判定（兼容 e.key 与 e.keyCode，覆盖中日韩键盘）
      const isEnter = e.key === 'Enter' || e.keyCode === 13;
      if (!isEnter) return;

      // enterToSend=true（默认）：Enter 发送，Shift+Enter 换行
      // enterToSend=false：需 Ctrl/Cmd + Enter 发送
      const shouldSend = prefs.enterToSend
        ? !e.shiftKey
        : e.ctrlKey || e.metaKey;

      if (!shouldSend) return;
      if (inOrNearComposition(e)) return;

      e.preventDefault();
      handleSend();
    },
    [prefs.enterToSend, isStreaming, inOrNearComposition, handleSend, onStop],
  );

  return {
    value,
    setValue,
    textareaRef,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    handleSend,
    canSend: !isStreaming && value.trim().length > 0,
    /** 是否启用了 Ctrl/Cmd+Enter 发送模式（用于 UI 提示） */
    useCtrlEnterToSend: !prefs.enterToSend,
  };
}
