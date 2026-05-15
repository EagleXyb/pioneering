import { useState, useRef, useCallback, useEffect } from 'react';

export function useChatScroll(messagesLength: number) {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(false);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    isAutoScrolling.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { isAutoScrolling.current = false; }, 500);
  }, []);

  useEffect(() => {
    if (messagesLength > 0) {
      scrollToBottom();
    }
  }, [messagesLength, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (isAutoScrolling.current) return;
    const container = chatContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBottom(distanceFromBottom > 100);
    setIsScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => { setIsScrolling(false); }, 1500);
  }, []);

  return {
    showScrollBottom,
    isScrolling,
    chatContainerRef,
    messagesEndRef,
    scrollToBottom,
    handleScroll,
  };
}
