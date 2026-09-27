'use client'

// ============================================================
// ContactForm — 联系表单四态（idle / loading / 字段级 error / success）
// 必填：姓名、联系方式（邮箱或电话）、简述。
// 一期无后端：校验通过后模拟提交，不产生任何请求。
// ============================================================

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/site/ui/Button'
import { isContact } from '@/lib/validation'

interface FieldDef {
  label: string
  placeholder?: string
  options?: string[]
}

interface ContactFormDef {
  name: FieldDef
  contact: FieldDef
  type: FieldDef
  note: FieldDef
  submit: string
  noteText: string
}

type Status = 'idle' | 'loading' | 'success'

interface Errors {
  name?: string
  contact?: string
  note?: string
}

const SUBMIT_LATENCY = 800

export function ContactForm({ form }: { form: ContactFormDef }) {
  const [values, setValues] = useState({ name: '', contact: '', type: form.type.options?.[0] ?? '', note: '' })
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<Errors>({})
  const successRef = useRef<HTMLDivElement>(null)

  // 成功态整体替换表单：把焦点移到成功提示并由读屏器播报，避免焦点丢失
  useEffect(() => {
    if (status === 'success') successRef.current?.focus()
  }, [status])

  function update(key: keyof typeof values, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }))
    if (key !== 'type') {
      setErrors((prev) => ({ ...prev, [key]: undefined }))
    }
  }

  function validate(): Errors {
    const next: Errors = {}
    if (!values.name.trim()) next.name = '请填写称呼'
    if (!values.contact.trim()) {
      next.contact = '请填写邮箱或手机号'
    } else if (!isContact(values.contact)) {
      next.contact = '联系方式格式不正确，请检查后重试'
    }
    if (!values.note.trim()) next.note = '请简单描述你的需求'
    return next
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const next = validate()
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setStatus('loading')
    setTimeout(() => setStatus('success'), SUBMIT_LATENCY)
  }

  if (status === 'success') {
    return (
      <div className="card">
        <div
          ref={successRef}
          tabIndex={-1}
          role="status"
          className="form-success"
          style={{ outline: 'none' }}
        >
          提交成功，我们已收到你的需求。当前为演示环境，信息不会被真实发送；正式上线后此处将接入联系表单服务。
        </div>
      </div>
    )
  }

  const disabled = status === 'loading'

  return (
    <form className="card" noValidate onSubmit={onSubmit}>
      <div className={`field${errors.name ? ' has-error' : ''}`}>
        <label htmlFor="contact-name">{form.name.label}</label>
        <input
          id="contact-name"
          type="text"
          value={values.name}
          placeholder={form.name.placeholder}
          disabled={disabled}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'contact-name-error' : undefined}
          onChange={(e) => update('name', e.target.value)}
        />
        {errors.name && (
          <div id="contact-name-error" className="form-error">
            {errors.name}
          </div>
        )}
      </div>
      <div className={`field${errors.contact ? ' has-error' : ''}`}>
        <label htmlFor="contact-contact">{form.contact.label}</label>
        <input
          id="contact-contact"
          type="text"
          value={values.contact}
          placeholder={form.contact.placeholder}
          disabled={disabled}
          aria-invalid={!!errors.contact}
          aria-describedby={errors.contact ? 'contact-contact-error' : undefined}
          onChange={(e) => update('contact', e.target.value)}
        />
        {errors.contact && (
          <div id="contact-contact-error" className="form-error">
            {errors.contact}
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="contact-type">{form.type.label}</label>
        <select
          id="contact-type"
          value={values.type}
          disabled={disabled}
          onChange={(e) => update('type', e.target.value)}
        >
          {form.type.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      <div className={`field${errors.note ? ' has-error' : ''}`}>
        <label htmlFor="contact-note">{form.note.label}</label>
        <textarea
          id="contact-note"
          value={values.note}
          placeholder={form.note.placeholder}
          disabled={disabled}
          aria-invalid={!!errors.note}
          aria-describedby={errors.note ? 'contact-note-error' : undefined}
          onChange={(e) => update('note', e.target.value)}
        />
        {errors.note && (
          <div id="contact-note-error" className="form-error">
            {errors.note}
          </div>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        style={{ width: '100%' }}
        disabled={disabled}
      >
        {status === 'loading' ? '提交中…' : form.submit}
      </Button>
      <div className="form-note">{form.noteText}</div>
    </form>
  )
}
