'use client'

// ============================================================
// TryComposer — #try 体验区输入行四态（idle/loading/error/success）
// 输入普通文本按「继续对话」处理；含 @ 时按邮箱校验。
// 一期无后端：校验通过后模拟提交，不产生任何请求。
// ============================================================

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/site/ui/Button'
import { isEmail } from '@/lib/validation'

type Status = 'idle' | 'loading' | 'success'

const SUBMIT_LATENCY = 700

export function TryComposer({
  placeholder,
  submitLabel,
  note,
}: {
  placeholder: string
  submitLabel: string
  note: string
}) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const v = value.trim()
    if (!v) {
      setError('先说点什么，或留下邮箱保存上下文')
      return
    }
    if (v.includes('@') && !isEmail(v)) {
      setError('邮箱格式不正确，请检查后重试')
      return
    }
    setError('')
    setStatus('loading')
    setTimeout(() => setStatus('success'), SUBMIT_LATENCY)
  }

  if (status === 'success') {
    return (
      <>
        <div className="form-success" role="status">
          已收到你的内容。当前为演示环境，不会真实保存对话上下文或发送邮件；正式上线后此处将接入智能体。
        </div>
        <div className="form-note">{note}</div>
      </>
    )
  }

  return (
    <form noValidate onSubmit={onSubmit}>
      <div className={`field mt-4${error ? ' has-error' : ''}`}>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label="对话输入"
          aria-invalid={!!error}
          disabled={status === 'loading'}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError('')
          }}
        />
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        style={{ width: '100%' }}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? '提交中…' : submitLabel}
      </Button>
      <div className="form-note">{note}</div>
    </form>
  )
}
