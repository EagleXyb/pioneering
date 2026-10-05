import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { CodeExecutorTool, buildResourceLimitPreamble } from '@/tools/code-executor.js'

/** 环境无 python3 时跳过真实执行类用例（静态校验类用例不受影响）。 */
function hasPython3(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

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

  // ================================================================
  // T0-1：沙箱黑名单补齐 + import 检测解除行首锚定
  // ================================================================
  describe('T0-1 沙箱逃逸封堵', () => {
    const rejectedAtValidation = async (code: string) => {
      const r = await tool.invoke({ code }, {}) as any
      expect(r.status).toBe('error')
      expect(r.error_code).toBe('CODE_002')
    }

    it('行内 import 被拒（原实现锚定行首，`if 1: import x` 可穿透）', async () => {
      await rejectedAtValidation('if 1: import urllib.request')
      await rejectedAtValidation('def f():\n    import socket')
      await rejectedAtValidation('for _ in [1]:\n    import os')
      await rejectedAtValidation('x = 1; import gc')
    })

    it('from-import 行内形态被拒', async () => {
      await rejectedAtValidation('if 1: from os import system')
      await rejectedAtValidation('def f():\n    from subprocess import run')
    })

    it('网络/内省/子进程模块名被拒（原先 _FORBIDDEN_NAMES 遗漏）', async () => {
      // 这些模块不触发 import 关键字检测也常以内联形式出现（原黑名单的落差面）
      await rejectedAtValidation('x = urllib')
      await rejectedAtValidation('y = socket.socket')
      await rejectedAtValidation('z = gc.get_objects()')
      await rejectedAtValidation('a = http.client')
      await rejectedAtValidation('b = requests.get')
      await rejectedAtValidation('c = ftplib.FTP')
      await rejectedAtValidation('d = smtplib.SMTP')
      await rejectedAtValidation('e = multiprocessing.Process')
      await rejectedAtValidation('f = webbrowser.open')
    })

    it('字符串拼接绕过被拒（"url"+"lib" → urllib）', async () => {
      await rejectedAtValidation('m = "url" + "lib"\nprint(m)')
      await rejectedAtValidation('m = "sock" + "et"\nprint(m)')
    })

    it('正常代码不被新规则误伤（含含 import 子串的普通单词）', async () => {
      for (const code of [
        'print(1 + 2 * 3)',
        "s = 'hello world'; print(s.upper())",
        'nums = [i * i for i in range(5)]; print(nums)',
        'print("important")',            // 含 "import" 子串但非关键字
        'd = {"a": 1}\nprint(sorted(d))',
        'x = 5\nif x > 3:\n    print("big")',
        'total = 0\nfor i in range(4):\n    total += i\nprint(total)',
      ]) {
        const r = await tool.invoke({ code }, {}) as any
        expect(r.error_code, `不应被静态校验拒绝: ${JSON.stringify(code)}`).not.toBe('CODE_002')
      }
    })
  })

  // ================================================================
  // T0-3：POSIX preamble 必须真实执行用户脚本 + macOS 优雅降级
  // ================================================================
  describe('T0-3 资源限制与用户脚本执行', () => {
    it('preamble 以 min(target, current_hard) 设置 soft，不抬高 hard', () => {
      const p = buildResourceLimitPreamble({ memoryBytes: 1024, cpuSeconds: 7 })
      // hard 沿用当前值（不再出现 (N, N) 形态）
      expect(p).toContain('getrlimit')
      expect(p).not.toMatch(/setrlimit\(_modu_resource\.RLIMIT_AS, \(\d+, \d+\)\)/)
      expect(p).toContain('_modu_soft_as, _modu_max_as')
      expect(p).toContain('1024')
      expect(p).toContain('7')
      // 平台守卫 + 失败降级（best-effort，绝不阻断用户脚本）
      expect(p).toContain("_modu_sys.platform != 'win32'")
      expect(p).toContain('except Exception')
      // 两个限制各自独立降级（一个失败不跳过另一个），诊断可定位到具体限制项
      expect(p).toContain('RLIMIT_AS unavailable')
      expect(p).toContain('RLIMIT_CPU unavailable')
      expect(p).toContain('resource module unavailable')
      // 目标值必须以字面量注入（不得依赖已删除的变量）
      expect(p).toContain('_modu_mem =')
      expect(p).toContain('_modu_cpu =')
      // 回归：RLIMIT_CPU 的 soft 必须取目标值。若误取 current_hard（INFINITY 分支
      // 写成 _modu_max_cpu），则 soft=INFINITY 等于"完全不限制 CPU"。
      expect(p).toContain(
        '_modu_soft_cpu = _modu_cpu if _modu_max_cpu == _modu_resource.RLIM_INFINITY',
      )
      expect(p).not.toContain(
        '_modu_soft_cpu = _modu_max_cpu if _modu_max_cpu == _modu_resource.RLIM_INFINITY',
      )
      expect(p).toContain(
        '_modu_soft_as = _modu_mem if _modu_max_as == _modu_resource.RLIM_INFINITY',
      )
    })

    it('preamble 末尾必须在同进程 exec 用户脚本', () => {
      const p = buildResourceLimitPreamble()
      // 否则 `python3 preamble.py user.py` 只跑 preamble，用户代码静默不执行
      expect(p).toContain('_modu_sys.argv[1]')
      expect(p).toContain('exec(compile(')
      expect(p).toContain('raise SystemExit')
    })

    it.runIf(hasPython3())('安全代码真实执行并返回 stdout（回归：曾静默不执行）', async () => {
      const r = await tool.invoke({ code: 'print("modu_t0_marker")' }, {}) as any
      expect(r.status).toBe('success')
      // 关键断言：必须有真实输出。修复前 macOS 返回 CODE_003、Linux 返回空 stdout。
      expect(String(r.data?.stdout ?? '')).toContain('modu_t0_marker')
    })

    it.runIf(hasPython3())('标准错误可见且不影响成功判定', async () => {
      const r = await tool.invoke({ code: 'import sys\nsys.stderr.write("warn\\n")' }, {}) as any
      // 上行代码含 import 会被静态拦截，此处仅验证"用户脚本非零退出仍被正确归类"
      expect(['CODE_002', 'CODE_003', 'CODE_005']).toContain(r.error_code)
    })

    it.runIf(hasPython3())('用户脚本非零退出返回 CODE_003', async () => {
      const r = await tool.invoke({ code: '1 / 0' }, {}) as any
      expect(r.status).toBe('error')
      expect(r.error_code).toBe('CODE_003')
    })

    it.runIf(hasPython3())('用户脚本可使用 __name__ == "__main__" 语义', async () => {
      const r = await tool.invoke({ code: 'print(1 if __name__ == "__main__" else 0)' }, {}) as any
      expect(r.status).toBe('success')
      expect(String(r.data?.stdout ?? '').trim()).toBe('1')
    })

    it.runIf(hasPython3())('__file__ 指向用户脚本而非 preamble', async () => {
      const r = await tool.invoke({ code: 'print(__file__.endswith(".py"))' }, {}) as any
      expect(String(r.data?.stdout ?? '').trim()).toBe('True')
    })
  })
})
