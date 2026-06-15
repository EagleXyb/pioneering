import { useState, useRef, useCallback, useEffect } from 'react'

interface UseResizablePanelOptions {
  initialWidth: number
  minWidth: number
  maxWidth: number
  defaultCollapsed?: boolean
  collapsedWidth?: number
}

export function useResizablePanel({
  initialWidth,
  minWidth,
  maxWidth,
  defaultCollapsed = false,
  collapsedWidth = 56,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(initialWidth)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    startX.current = e.clientX
    startWidth.current = width

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startX.current - ev.clientX
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width, minWidth, maxWidth])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const displayWidth = collapsed ? collapsedWidth : width

  return {
    width: displayWidth,
    collapsed,
    setCollapsed,
    toggleCollapsed,
    handleMouseDown,
    isDragging,
  }
}
