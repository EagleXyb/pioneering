import { describe, it, expect } from 'vitest';
import {
  CODE_LENGTH,
  LOCK_SECONDS,
  MAX_ATTEMPTS,
  PHONE_LENGTH,
  RE_EMAIL,
  RE_MOBILE,
  checkAccount,
  checkCode,
  checkPassword,
  checkPhone,
  digitsOnly,
  fieldError,
  formatLock,
} from './loginValidation';

describe('loginValidation — 常量', () => {
  it('与原型 login.js 的常量一致', () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(LOCK_SECONDS).toBe(15 * 60);
    expect(PHONE_LENGTH).toBe(11);
    expect(CODE_LENGTH).toBe(6);
  });

  it('手机号正则限定为 1[3-9] 开头的 11 位（原型 RE_MOBILE）', () => {
    expect(RE_MOBILE.test('13800138000')).toBe(true);
    expect(RE_MOBILE.test('19912345678')).toBe(true);
    expect(RE_MOBILE.test('12800138000')).toBe(false); // 第 2 位为 2
    expect(RE_MOBILE.test('1080013800')).toBe(false); // 10 位
    expect(RE_MOBILE.test('138001380001')).toBe(false); // 12 位
  });

  it('邮箱正则要求 @ 与点号后均非空（原型 RE_EMAIL）', () => {
    expect(RE_EMAIL.test('design@nova-ai.com')).toBe(true);
    expect(RE_EMAIL.test('design@nova')).toBe(false);
    expect(RE_EMAIL.test('design nova@a.com')).toBe(false);
  });
});

describe('checkAccount', () => {
  it('空值返回必填错误', () => {
    const result = checkAccount('   ');
    expect(result.valid).toBe(false);
    expect(result.tone).toBe('err');
    expect(result.message).toBe('请输入用户名或邮箱');
  });

  it('用户名不做格式拦截（后端按 users.username 精确匹配）', () => {
    const result = checkAccount('admin');
    expect(result.valid).toBe(true);
    expect(result.tone).toBe('none');
    expect(result.message).toBe('');
  });

  it('邮箱 / 手机号 / 残缺格式一律通过，是否存在交由后端判定', () => {
    expect(checkAccount('design@nova-ai.com').valid).toBe(true);
    expect(checkAccount('13800138000').valid).toBe(true);
    expect(checkAccount('138001380').valid).toBe(true);
    expect(checkAccount('design@').valid).toBe(true);
  });
});

describe('checkPassword', () => {
  it('空值返回必填错误', () => {
    const result = checkPassword('');
    expect(result.valid).toBe(false);
    expect(result.message).toBe('密码为必填项');
  });

  it('不设长度门槛：后端注册下限为 min(6)，登录侧不重复拦截', () => {
    expect(checkPassword('1').valid).toBe(true);
    expect(checkPassword('123456').valid).toBe(true);
    expect(checkPassword('1234567').valid).toBe(true);
  });
});

describe('checkPhone / checkCode（验证码面板规则，面板本期为占位）', () => {
  it('手机号必填与格式校验', () => {
    expect(checkPhone('').message).toBe('手机号为必填项');
    expect(checkPhone('138001380').message).toBe('手机号需为 11 位中国大陆号码，当前 9 位');
    expect(checkPhone('13800138000', true)).toMatchObject({
      valid: true,
      tone: 'ok',
      message: '✓ 手机号格式正确',
    });
  });

  it('验证码必填与 6 位数字校验', () => {
    expect(checkCode('').message).toBe('验证码为必填项');
    expect(checkCode('12345').message).toBe('验证码为 6 位数字');
    expect(checkCode('123456', true)).toMatchObject({
      valid: true,
      tone: 'ok',
      message: '✓ 验证码格式正确',
    });
  });
});

describe('digitsOnly', () => {
  it('过滤非数字并截断到指定长度', () => {
    expect(digitsOnly('138-0013-8000', PHONE_LENGTH)).toBe('13800138000');
    expect(digitsOnly('13800138000999', PHONE_LENGTH)).toBe('13800138000');
    expect(digitsOnly('12a34b56', CODE_LENGTH)).toBe('123456');
  });
});

describe('formatLock', () => {
  it('按「X 分 YY 秒」格式化（原型 formatLock）', () => {
    expect(formatLock(15 * 60 * 1000)).toBe('15 分 00 秒');
    expect(formatLock(65 * 1000)).toBe('1 分 05 秒');
    expect(formatLock(59 * 1000)).toBe('0 分 59 秒');
  });

  it('零值与负值归一为 0 分 00 秒', () => {
    expect(formatLock(0)).toBe('0 分 00 秒');
    expect(formatLock(-1000)).toBe('0 分 00 秒');
  });

  it('向上取整到整秒', () => {
    expect(formatLock(1201)).toBe('0 分 02 秒');
  });
});

describe('fieldError', () => {
  it('由外部文案构造字段错误态', () => {
    expect(fieldError('密码错误，还可重试 4 次')).toEqual({
      valid: false,
      message: '密码错误，还可重试 4 次',
      tone: 'err',
    });
  });
});
