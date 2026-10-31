'use client'

// ============================================================
// TryComposer — 体验区唯一转化入口
//
// 不再模拟提交：有真实产品地址时渲染跳转按钮，未配置时明确标注内测中，
// 避免展示"提交成功"等不产生任何请求的假状态。
// ============================================================

import { Button } from '@/components/site/ui/Button'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').trim()

export function TryComposer({
  label,
  note,
}: {
  label: string
  note: string
}) {
  if (!APP_URL) {
    return (
      <>
        <Button variant="primary" style={{ width: '100%' }} disabled>
          产品内测中，暂未开放
        </Button>
        <div className="form-note">{note}</div>
      </>
    )
  }

  const href = `${APP_URL}?utm_source=marketing&utm_medium=site&utm_campaign=agent_try`
  return (
    <>
      <Button href={href} variant="primary" style={{ width: '100%' }}>
        {label}
      </Button>
      <div className="form-note">{note}</div>
    </>
  )
}
