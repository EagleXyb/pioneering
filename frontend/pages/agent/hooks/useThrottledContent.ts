import { useState, useEffect, useRef } from 'react'

export function useThrottledContent(rawContent: string, interval = 50): string {
  const [display, setDisplay] = useState(rawContent)
  const lastUpdateRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const now = performance.now()
    const elapsed = now - lastUpdateRef.current

    if (elapsed >= interval) {
      setDisplay(rawContent)
      lastUpdateRef.current = now
    } else {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setDisplay(rawContent)
        lastUpdateRef.current = performance.now()
      })
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [rawContent, interval])

  return display
}
