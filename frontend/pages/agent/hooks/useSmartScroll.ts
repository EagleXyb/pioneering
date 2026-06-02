import { useRef, useCallback, useEffect, type RefObject } from 'react'

export interface SmartScrollResult {
  containerRef: RefObject<HTMLDivElement | null>
  scrollToBottom: () => void
  userScrolledUpRef: RefObject<boolean>
}

export function useSmartScroll(deps: unknown[]): SmartScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const userScrolledUpRef = useRef(false)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const threshold = 80
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledUpRef.current = distanceFromBottom > threshold
  }, [])

  const scrollToBottom = useCallback(() => {
    if (!userScrolledUpRef.current && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [])

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, deps)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  return { containerRef, scrollToBottom, userScrolledUpRef }
}
