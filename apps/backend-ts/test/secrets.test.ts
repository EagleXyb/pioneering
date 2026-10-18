/**
 * P5 回归：密钥来源解析（env / file）
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSecretsFile, resolveLlmSecrets } from '../src/core/secrets.ts'

const tmpFiles: string[] = []

function writeTemp(content: unknown, mode = 0o600): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p5-secrets-'))
  const file = path.join(dir, 'llm-secrets.json')
  fs.writeFileSync(file, JSON.stringify(content), { mode })
  tmpFiles.push(file)
  return file
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f)
      fs.rmdirSync(path.dirname(f))
    } catch {
      // 忽略
    }
  }
})

describe('resolveLlmSecrets', () => {
  it('file provider 读取 apiKey / baseUrl', () => {
    const file = writeTemp({ llm: { apiKey: 'file-key', baseUrl: 'https://file.test/v1' } })
    const secrets = resolveLlmSecrets({
      provider: 'file',
      filePath: file,
      envFallback: { apiKey: 'env-key', baseUrl: 'https://env.test/v1' },
    })
    expect(secrets).toEqual({
      apiKey: 'file-key',
      baseUrl: 'https://file.test/v1',
      source: 'file',
    })
  })

  it('file 缺失时回退 env', () => {
    const secrets = resolveLlmSecrets({
      provider: 'file',
      filePath: '/definitely/missing/llm-secrets.json',
      envFallback: { apiKey: 'env-key', baseUrl: 'https://env.test/v1' },
    })
    expect(secrets).toMatchObject({ apiKey: 'env-key', source: 'env' })
  })

  it('file 只有 apiKey 时 baseUrl 用 env 兜底', () => {
    const file = writeTemp({ apiKey: 'only-key' })
    const secrets = resolveLlmSecrets({
      provider: 'file',
      filePath: file,
      envFallback: { apiKey: 'env-key', baseUrl: 'https://env.test/v1' },
    })
    expect(secrets).toEqual({
      apiKey: 'only-key',
      baseUrl: 'https://env.test/v1',
      source: 'file',
    })
  })

  it('缺少 apiKey 的 JSON 视为无效', () => {
    const file = writeTemp({ llm: { baseUrl: 'https://x.test' } })
    expect(readSecretsFile(file)).toBeNull()
  })
})
