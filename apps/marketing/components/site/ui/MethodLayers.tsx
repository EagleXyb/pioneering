'use client'

// ============================================================
// MethodLayers — 认知模型滚动逐层点亮
//
// 进入视口后三层按节奏（spring 入场 + 依次 .on 高亮）点亮，
// 表达「看见 → 理解 → 重构」的流程推进；仅播放一次。
// 用户系统开启"减少动态效果"时直接全亮、无位移动画。
// ============================================================

import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

interface MethodLayer {
  badge: string
  title: string
  desc: string
}

const LAYER_STAGGER = 350

export function MethodLayers({ layers }: { layers: readonly MethodLayer[] }) {
  const reduce = useReducedMotion()
  const [started, setStarted] = useState(false)
  const [activeCount, setActiveCount] = useState(0)

  useEffect(() => {
    if (!started) return
    const timers = layers.map((_, i) =>
      setTimeout(() => setActiveCount(i + 1), i * LAYER_STAGGER),
    )
    return () => timers.forEach(clearTimeout)
  }, [started, layers.length])

  if (reduce) {
    return (
      <div className="model">
        {layers.map((l, i) => (
          <div key={l.badge}>
            <div className="layer on">
              <div className="lbadge">{l.badge}</div>
              <div>
                <div className="lt">{l.title}</div>
                <div className="ld">{l.desc}</div>
              </div>
            </div>
            {i < layers.length - 1 && <div className="arrow-down">↓</div>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <motion.div
      className="model"
      onViewportEnter={() => setStarted(true)}
      viewport={{ once: true, margin: '-80px' }}
    >
      {layers.map((l, i) => (
        <div key={l.badge}>
          <motion.div
            className={`layer${i < activeCount ? ' on' : ''}`}
            initial={{ opacity: 0, y: 16 }}
            animate={started ? { opacity: 1, y: 0 } : undefined}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 28,
              delay: i * 0.18,
            }}
          >
            <div className="lbadge">{l.badge}</div>
            <div>
              <div className="lt">{l.title}</div>
              <div className="ld">{l.desc}</div>
            </div>
          </motion.div>
          {i < layers.length - 1 && (
            <motion.div
              className="arrow-down"
              initial={{ opacity: 0 }}
              animate={started && i < activeCount ? { opacity: 1 } : undefined}
              transition={{ duration: 0.3, delay: i * 0.18 + 0.24 }}
            >
              ↓
            </motion.div>
          )}
        </div>
      ))}
    </motion.div>
  )
}
