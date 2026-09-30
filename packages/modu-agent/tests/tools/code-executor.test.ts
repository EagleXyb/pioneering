import { describe, it, expect } from 'vitest'
import { CodeExecutorTool, buildResourceLimitPreamble } from '@/tools/code-executor.js'

describe('CodeExecutorTool', () => {
  const tool = new CodeExecutorTool()

  it('returns its name and requires approval', () => {
    expect(tool.name()).toBe('code_executor')
    expect(tool.requiresApproval()).toBe(true)
  })

  it('rejects empty code (CODE_001)', async () => {
    const r = await tool.invoke({ code: '' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_001')
  })

  it('rejects import statements (CODE_002)', async () => {
    const r = await tool.invoke({ code: 'import os' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_002')
  })

  it('rejects forbidden names such as eval (CODE_002)', async () => {
    const r = await tool.invoke({ code: 'eval("1+1")' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_002')
  })

  it('rejects forbidden attribute access such as __class__ (CODE_002)', async () => {
    const r = await tool.invoke({ code: 'x = (1).__class__' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_002')
  })

  // === P0-5：__getattribute__ 字符串传参逃逸链（静态阶段必须拒绝，不启动子进程）===
  describe('P0-5 元编程逃逸链封堵', () => {
    const rejectedAtValidation = async (code: string) => {
      const r = await tool.invoke({ code }, {}) as any
      expect(r.status).toBe('error')
      expect(r.error_code).toBe('CODE_002')
    }

    it('报告 PoC：__getattribute__ 串联 __class__→__base__→__subclasses__', async () => {
      await rejectedAtValidation(
        "().__getattribute__('__class__').__getattribute__('__base__').__getattribute__('__subclasses__')()",
      )
    })

    it('__getattr__ / __init_subclass__ 元属性访问被拒', async () => {
      await rejectedAtValidation("x.__getattr__('__class__')")
      await rejectedAtValidation('X.__init_subclass__()')
    })

    it('__reduce__ / __reduce_ex__ 反序列化逃逸入口被拒', async () => {
      await rejectedAtValidation('(1).__reduce__()')
      await rejectedAtValidation('(1).__reduce_ex__(4)')
    })

    it('下标/字符串形态：obj["__getattribute__"] 被拒（片段检测）', async () => {
      await rejectedAtValidation("()['__getattribute__']")
      await rejectedAtValidation("x['__subclasses__']")
    })

    it('朴素字符串拼接形态被拒（__get + attribute__）', async () => {
      await rejectedAtValidation("x.__getattribute__('__cl'+'ass__')")
    })

    it('正常算术/字符串代码不被误伤', async () => {
      for (const code of [
        'print(1 + 2 * 3)',
        "s = 'hello world'; print(s.upper())",
        'nums = [i * i for i in range(5)]; print(nums)',
      ]) {
        const r = await tool.invoke({ code }, {}) as any
        expect(r.error_code).not.toBe('CODE_002')
      }
    })
  })

  it('passes validation for safe arithmetic (not CODE_002)', async () => {
    const r = await tool.invoke({ code: 'print(1 + 2 * 3)' }, {}) as any
    // Either executed successfully, or environment lacks python3 (CODE_005).
    // The important assertion is that static validation did not reject it.
    expect(r.error_code).not.toBe('CODE_002')
  })

  it('returns a structured rejection when approval is declined', () => {
    const r = tool.onApprovalRejected({ code: 'print(1)' }) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_APPROVAL_REJECTED')
  })
})
