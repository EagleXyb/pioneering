'use client'

// ============================================================
// NewsletterForm — 订阅表单四态（idle / loading / error / success）
// 一期无后端：校验通过后模拟提交，不产生任何请求。
// ============================================================

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/site/ui/Button'
import { isEmail } from '@/lib/validation'

type Status = 'idle' | 'loading' | 'success'

const SUBMIT_LATENCY = 700

export function NewsletterForm({
  placeholder,
  note,
}: {
  placeholder: string
  note: string
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = email.trim()
    if (!value) {
      setError('请输入邮箱地址')
      return
    }
    if (!isEmail(value)) {
      setError('邮箱格式不正确，请检查后重试')
      return
    }
    setError('')
    setStatus('loading')
    setTimeout(() => setStatus('success'), SUBMIT_LATENCY)
  }

  if (status === 'success') {
    return (
      <div className="form-success nl-feedback" role="status">
        订阅请求已收到。当前为演示环境，不会真实发送邮件；正式上线后此处将接入订阅服务。
      </div>
    )
  }

  return (
    <>
      <form
        className={`nl-form${error ? ' has-error' : ''}`}
        noValidate
        onSubmit={onSubmit}
      >
        <input
          type="email"
          value={email}
          placeholder={placeholder}
          aria-label="邮箱地址"
          aria-invalid={!!error}
          disabled={status === 'loading'}
          onChange={(e) => {
            setEmail(e.target.value)
            if (error) setError('')
          }}
        />
        <Button type="submit" variant="primary" className="nl-submit" disabled={status === 'loading'}>
          {status === 'loading' ? '提交中…' : '订阅'}
        </Button>
      </form>
      <div className="nl-feedback" aria-live="polite">
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="small mt-2">{note}</div>
    </>
  )
}
