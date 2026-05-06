import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface FloatingCursorRef {
  updatePosition: (x: number, y: number) => void;
  show: () => void;
  hide: () => void;
}

const FloatingCursor = forwardRef<FloatingCursorRef, {}>((_, ref) => {
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
        backgroundColor: '#1377ed',
        transition: 'transform 0.05s ease-out',
        opacity: 0,
        pointerEvents: 'none',
        willChange: 'transform',
      }}
    />
  );
});

FloatingCursor.displayName = 'FloatingCursor';

export default FloatingCursor;
