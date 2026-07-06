import { useState, useCallback, useRef, useEffect } from 'react'

interface ResizableOptions {
  initialSize: number
  minSize: number
  maxSize: number
  direction?: 'horizontal' | 'vertical'
}

export function useResizable({ initialSize, minSize, maxSize, direction = 'horizontal' }: ResizableOptions) {
  const [size, setSize] = useState(initialSize)
  const [isResizing, setIsResizing] = useState(false)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = size
    },
    [size, direction]
  )

  useEffect(() => {
    if (!isResizing) return

    const onMouseMove = (e: MouseEvent) => {
      const delta = (direction === 'horizontal' ? e.clientX : e.clientY) - startPos.current
      const newSize = startSize.current + delta
      setSize(Math.max(minSize, Math.min(maxSize, newSize)))
    }

    const onMouseUp = () => setIsResizing(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isResizing, minSize, maxSize, direction])

  return { size, isResizing, onMouseDown, setSize }
}
