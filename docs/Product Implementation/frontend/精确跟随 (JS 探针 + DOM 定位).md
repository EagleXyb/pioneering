# 精确跟随 (JS 探针 + DOM 定位)

以下是在现有的 React + TypeScript 项目中实现方案一（JS 光标精确跟随）的完整步骤与代码。方案一的核心是：用一个独立的光标元素（绝对定位 + 闪烁动画），通过 DOM 探针 找到当前消息内容的最后一个文本节点，计算其末尾坐标，然后将光标元素移动到该位置，实现无缝跟随。

## 1. 整体思路
光标元素：创建一个 div 或 span，绝对定位，样式表现为一个闪烁的竖线（或喜欢的样式）。

定位逻辑：每次 answerContent 变化（尤其是流式输出时），用 getLastTextNode 深度遍历找到最后一个文本节点。

计算坐标：在该文本节点的末尾创建一个零宽度临时节点，通过 Range.getBoundingClientRect() 获取其精确坐标。

移动光标：将光标元素的 transform: translate(x, y) 设置为该坐标。

清理：组件卸载时移除光标元素；isLoading 结束时隐藏/移除光标。

## 2. 实现步骤
### 2.1 创建光标组件（独立 UI 元素）
这个组件负责显示一个闪烁的竖线，并提供外部调用的 updatePosition 方法。

```tsx
// FloatingCursor.tsx
import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';

export interface FloatingCursorRef {
  updatePosition: (x: number, y: number) => void;
  show: () => void;
  hide: () => void;
}

interface FloatingCursorProps {
  containerRef: React.RefObject<HTMLElement>; // 相对定位的容器
}

const FloatingCursor = forwardRef<FloatingCursorRef, FloatingCursorProps>(({ containerRef }, ref) => {
  const cursorRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    updatePosition: (x: number, y: number) => {
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate(${x}px, ${y}px)`;
        cursorRef.current.style.opacity = '1';
      }
    },
    show: () => {
      if (cursorRef.current) cursorRef.current.style.opacity = '1';
    },
    hide: () => {
      if (cursorRef.current) cursorRef.current.style.opacity = '0';
    },
  }));

  return (
    <div
      ref={cursorRef}
      className="floating-cursor"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '2px',
        height: '1.2em',
        backgroundColor: 'currentColor',
        transition: 'transform 0.05s ease-out',
        opacity: 0,
        pointerEvents: 'none',
        willChange: 'transform',
      }}
    />
  );
});

export default FloatingCursor;

```

配套 CSS（全局或 CSS Modules）：

```css
.floating-cursor {
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

### 2.2 工具函数：获取最后一个文本节点

```tsx
// getLastTextNode.ts
export function getLastTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') {
    return node as Text;
  }
  if (node.childNodes) {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const found = getLastTextNode(node.childNodes[i]);
      if (found) return found;
    }
  }
  return null;
}

```

### 2.3 核心 Hook：useFloatingCursor
封装所有光标定位逻辑，接收 answerContent 和 isLoading 的变化。

```tsx
// useFloatingCursor.ts
import { useEffect, useRef, RefObject } from 'react';
import { getLastTextNode } from './getLastTextNode';
import { FloatingCursorRef } from './FloatingCursor';

export function useFloatingCursor(
  content: string,
  isLoading: boolean,
  markdownContainerRef: RefObject<HTMLElement>,
  cursorRef: RefObject<FloatingCursorRef>
) {
  const rafIdRef = useRef<number | null>(null);
  const lastTextNodeRef = useRef<Text | null>(null);

  const updateCursorPosition = () => {
    if (!markdownContainerRef.current || !cursorRef.current) return;
    const container = markdownContainerRef.current;
    // 1. 找到最后一个文本节点
    const lastTextNode = getLastTextNode(container);
    if (!lastTextNode) {
      cursorRef.current.hide();
      return;
    }
    lastTextNodeRef.current = lastTextNode;

    // 2. 创建零宽度探测节点
    const probe = document.createTextNode('');
    lastTextNode.parentNode?.insertBefore(probe, lastTextNode.nextSibling);

    // 3. 获取探测节点的位置
    const range = document.createRange();
    range.setStart(probe, 0);
    range.setEnd(probe, 0);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // 4. 计算相对坐标
    const x = rect.left - containerRect.left;
    const y = rect.top - containerRect.top;

    // 5. 移动光标
    cursorRef.current.updatePosition(x, y);

    // 6. 清理探测节点
    probe.remove();
  };

  useEffect(() => {
    if (!isLoading) {
      cursorRef.current?.hide();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      return;
    }

    // 流式更新时，使用 requestAnimationFrame 节流
    const scheduleUpdate = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        updateCursorPosition();
        rafIdRef.current = null;
      });
    };

    scheduleUpdate();

    // 监听容器大小变化或滚动（可选）
    const container = markdownContainerRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver(() => scheduleUpdate());
    resizeObserver.observe(container);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [content, isLoading, markdownContainerRef, cursorRef]);
}

```

优化点：

使用 requestAnimationFrame 合并多次更新，避免每帧都操作 DOM。

ResizeObserver 监听容器大小变化（如换行导致高度改变），重新定位光标。

缓存最后一个文本节点（这里简化了，每次重新查找，但对一般长度的消息开销不大）。

### 2.4 在聊天消息组件中集成

```tsx
// ChatMessage.tsx
import React, { useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import FloatingCursor, { FloatingCursorRef } from './FloatingCursor';
import { useFloatingCursor } from './useFloatingCursor';

interface Props {
  answerContent: string;
  isLoading: boolean;
}

const ChatMessage: React.FC<Props> = ({ answerContent, isLoading }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<FloatingCursorRef>(null);

  // 调用 hook，传入内容、加载状态、容器引用和光标引用
  useFloatingCursor(answerContent, isLoading, containerRef, cursorRef);

  return (
    <div
      ref={containerRef}
      className="chat-message-markdown"
      style={{ position: 'relative' }} // 必须为 relative，光标才能绝对定位
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {answerContent}
      </ReactMarkdown>
      <FloatingCursor ref={cursorRef} containerRef={containerRef} />
    </div>
  );
};

export default ChatMessage;

```

### 2.5 样式微调
确保 chat-message-markdown 容器是 position: relative，且内部的 Markdown 元素可以是块级或内联，不影响光标计算的相对坐标。

```css
.chat-message-markdown {
  position: relative;
  /* 其他样式 （字体、行高等） */
  line-height: 1.5;
  font-size: 1rem;
}
```

## 3. 可选增强：滚动时重新定位

```ts
useEffect(() => {
  const container = markdownContainerRef.current;
  if (!container) return;
  const handleScroll = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(updateCursorPosition);
  };
  container.addEventListener('scroll', handleScroll);
  return () => container.removeEventListener('scroll', handleScroll);
}, [markdownContainerRef]);
```

