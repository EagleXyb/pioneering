import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readInputPrefs } from '../lib/inputPreferences';

/**
 * 消息行内编辑 Hook（用户气泡「点击编辑」后的编辑态逻辑）
 *
 * 与 useTaskInput 的差异：编辑态不存在草稿持久化（会话切换即丢弃），
 * 但保留同样的键盘与 IME 语义，避免"同一产品里两种 Enter 行为"：
 *   - Enter 发送 / Shift+Enter 换行（enterToSend=true，默认）
 *   - Ctrl(⌘)+Enter 发送（enterToSend=false）
 *   - IME 合成态忽略 Enter（Safari iOS compositionend 与 keydown 同时触发的时间戳二次校验）
 *   - Escape 取消编辑并阻止冒泡（否则会触达输入框的"停止生成"）
 */

const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 240;

/** Safari iOS 检测：compositionend 与 Enter keydown 会同时触发，需要时间戳二次校验 */
const isSafari =
  typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

export interface UseMessageEditOptions {
  /** 进入编辑态时的初始文本（原始正文） */
  initialText: string;
  /** 是否正在提交（提交中禁用发送/取消） */
  submitting?: boolean;
  onSubmit: (text: string) => void | Promise<void>;
  onCancel: () => void;
}

export function useMessageEdit({
  initialText,
  submitting = false,
  onSubmit,
  onCancel,
}: UseMessageEditOptions) {
  const [value, setValue] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(-Infinity);

  const prefs = useMemo(readInputPrefs, []);

  // ---- 自动增高：min/max 以 CSS 计算值为准，响应式断点自动生效 ----
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '';
    const cs = window.getComputedStyle(el);
    const cssMin = parseFloat(cs.minHeight);
    const cssMax = parseFloat(cs.maxHeight);
    const min = Number.isFinite(cssMin) && cssMin > 0 ? cssMin : TEXTAREA_MIN_HEIGHT;
    const max = Number.isFinite(cssMax) && cssMax > 0 ? cssMax : TEXTAREA_MAX_HEIGHT;
    let height = el.value ? el.scrollHeight : min;
    if (height < min) height = min;
    if (height > max) height = max;
    el.style.height = `${height}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  // ---- 进入编辑态自动聚焦，光标置于末尾（便于续写而不是重输） ----
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      try {
        el.setSelectionRange(end, end);
      } catch {
        // 某些浏览器在未聚焦时不支持 setSelectionRange，忽略
      }
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

  const canSubmit = !submitting && value.trim().length > 0;

  // ---- 提交：空内容/提交中一律拒绝（键盘路径与按钮路径共用） ----
  const handleSubmit = useCallback(() => {
    if (submitting) return;
    const text = value.trim();
    if (!text) return;
    void onSubmit(text);
  }, [submitting, value, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape：取消编辑。必须阻止冒泡，否则会触达输入区的"停止生成"。
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!submitting) onCancel();
        return;
      }

      const isEnter = e.key === 'Enter' || e.keyCode === 13;
      if (!isEnter) return;

      const shouldSend = prefs.enterToSend ? !e.shiftKey : e.ctrlKey || e.metaKey;
      if (!shouldSend) return;
      if (inOrNearComposition(e)) return;

      e.preventDefault();
      handleSubmit();
    },
    [prefs.enterToSend, inOrNearComposition, handleSubmit, onCancel, submitting],
  );

  return {
    value,
    setValue,
    textareaRef,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    handleSubmit,
    canSubmit,
    submitting,
    /** 是否启用了 Ctrl/Cmd+Enter 发送模式 */
    useCtrlEnterToSend: !prefs.enterToSend,
  };
}
