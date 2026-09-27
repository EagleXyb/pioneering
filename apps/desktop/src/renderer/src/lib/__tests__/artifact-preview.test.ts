import { describe, it, expect } from 'vitest'
import {
  detectArtifactPreview,
  getFileExtension,
  toHumanError
} from '../artifact-preview'

describe('getFileExtension', () => {
  it('返回小写扩展名（不含点）', () => {
    expect(getFileExtension('report.md')).toBe('md')
    expect(getFileExtension('Report.MD')).toBe('md')
    expect(getFileExtension('a.b.txt')).toBe('txt')
  })

  it('无扩展名 / 隐藏文件 / 结尾为点 → 空串', () => {
    expect(getFileExtension('README')).toBe('')
    expect(getFileExtension('.gitignore')).toBe('')
    expect(getFileExtension('weird.')).toBe('')
  })
})

describe('detectArtifactPreview', () => {
  it('Markdown 按扩展名判定', () => {
    expect(detectArtifactPreview('news.md')).toEqual({ type: 'markdown', language: 'md' })
    expect(detectArtifactPreview('doc.markdown')).toEqual({
      type: 'markdown',
      language: 'markdown'
    })
  })

  it('Markdown 按 MIME 判定（无扩展名产物）', () => {
    expect(detectArtifactPreview('artifact', 'text/markdown')).toEqual({
      type: 'markdown',
      language: 'markdown'
    })
  })

  it('HTML 按扩展名与 MIME 判定', () => {
    expect(detectArtifactPreview('index.html')).toEqual({ type: 'html', language: 'html' })
    expect(detectArtifactPreview('page.htm')).toEqual({ type: 'html', language: 'htm' })
    expect(detectArtifactPreview('x', 'text/html')).toEqual({ type: 'html', language: 'html' })
  })

  it('MIME 带 charset 参数时仍能识别', () => {
    expect(detectArtifactPreview('x', 'text/html; charset=utf-8')).toEqual({
      type: 'html',
      language: 'html'
    })
  })

  it('SVG 走沙箱 iframe（不被 image/* 拒绝）', () => {
    expect(detectArtifactPreview('chart.svg')).toEqual({ type: 'svg', language: 'svg' })
    expect(detectArtifactPreview('chart', 'image/svg+xml')).toEqual({
      type: 'svg',
      language: 'svg'
    })
  })

  it('Mermaid 走矢量图渲染', () => {
    expect(detectArtifactPreview('flow.mmd')).toEqual({ type: 'mermaid', language: 'mmd' })
    expect(detectArtifactPreview('flow.mermaid')).toEqual({
      type: 'mermaid',
      language: 'mermaid'
    })
  })

  it('图片 / 音视频 / 压缩包 / 办公文档等二进制类型拒绝应用内预览', () => {
    expect(detectArtifactPreview('shot.png', 'image/png')).toBeNull()
    expect(detectArtifactPreview('photo.jpg', 'image/jpeg')).toBeNull()
    expect(detectArtifactPreview('blob', 'application/octet-stream')).toBeNull()
    expect(detectArtifactPreview('doc.pdf', 'application/pdf')).toBeNull()
    expect(detectArtifactPreview('a.zip', 'application/zip')).toBeNull()
    expect(detectArtifactPreview('song', 'audio/mpeg')).toBeNull()
    expect(
      detectArtifactPreview(
        'report.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBeNull()
  })

  it('文本类应用 MIME 仍可预览', () => {
    expect(detectArtifactPreview('data.json', 'application/json')).toEqual({
      type: 'code',
      language: 'json'
    })
  })

  it('未知扩展名回退代码视图（未识别语言会降级纯文本）', () => {
    expect(detectArtifactPreview('data.json')).toEqual({ type: 'code', language: 'json' })
    expect(detectArtifactPreview('notes.txt')).toEqual({ type: 'code', language: 'txt' })
    expect(detectArtifactPreview('README')).toEqual({ type: 'code', language: 'code' })
  })
})

describe('toHumanError', () => {
  it('已知主进程错误 → 中文提示', () => {
    expect(toHumanError('File exceeds maximum allowed size', 'a.md')).toBe(
      '文件超过 10MB 上限，无法在应用内预览'
    )
    expect(toHumanError('Invalid or disallowed file path', 'a.md')).toBe(
      '该文件路径不在允许访问范围内'
    )
  })

  it('未知错误原样透传', () => {
    expect(toHumanError('some unknown failure', 'a.md')).toBe('some unknown failure')
  })

  it('无错误文案 → 兜底提示', () => {
    expect(toHumanError(undefined, 'a.md')).toBe('读取「a.md」失败')
  })
})
