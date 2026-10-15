/**
 * 登录页校验规则 — 纯函数，逐条对齐原型 docs/login-app/scripts/login.js
 *
 * 分离为纯函数的原因：
 *   1. 便于单元测试（不依赖 DOM）
 *   2. 登录页只负责把结果映射到字段状态类与提示文案
 *
 * 说明：本模块的规则是**前端体验规则**，与后端 LoginRequestSchema 的约束
 *      （仅 username/password 非空且长度受限）相互独立，不构成安全边界。
 */

/** 中国大陆手机号：1 开头，第 2 位 3-9，共 11 位（原型 RE_MOBILE）
 *  仅用于验证码面板的手机号校验；账号校验已不再按格式拦截，见 checkAccount。 */
export const RE_MOBILE = /^1[3-9]\d{9}$/;

/** 邮箱：非空白 + @ + 非空白 + . + 非空白（原型 RE_EMAIL）
 *  同上，保留供验证码面板的邮箱场景使用。 */
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 验证码：6 位数字（原型 RE_CODE） */
export const RE_CODE = /^\d{6}$/;

/** 连续失败上限（原型 MAX_ATTEMPTS） */
export const MAX_ATTEMPTS = 5;

/** 锁定时长：15 分钟（原型 LOCK_SECONDS） */
export const LOCK_SECONDS = 15 * 60;

/** 手机号最大输入长度 */
export const PHONE_LENGTH = 11;

/** 验证码长度 */
export const CODE_LENGTH = 6;

/** 字段提示的语义色调：ok=通过态 / err=错误态 / none=无提示 */
export type FieldTone = 'ok' | 'err' | 'none';

export interface FieldResult {
  /** 校验是否通过 */
  valid: boolean;
  /** 提示文案（none 时为空串） */
  message: string;
  /** 提示色调 */
  tone: FieldTone;
}

const PASS = (message: string, tone: FieldTone): FieldResult => ({ valid: true, message, tone });
const FAIL = (message: string): FieldResult => ({ valid: false, message, tone: 'err' });

/** 字段初始态：无提示（对应原型 setFieldState(field, input, null, '') 之后的空态） */
export const FIELD_UNTOUCHED: FieldResult = { valid: true, message: '', tone: 'none' };

/** 由外部文案构造错误态（服务端返回的失败原因挂到字段上时使用） */
export function fieldError(message: string): FieldResult {
  return { valid: false, message, tone: 'err' };
}

/**
 * 账号：仅做必填校验，**不做格式拦截**（对原型的有意偏离）
 *
 * 原型要求账号必须是「11 位手机号」或「企业邮箱」，但后端 POST /auth/login
 * 目前只按 `users.username` 精确匹配（不查 email、不查 phone），用户名
 * （如 `admin`）同样是系统内的合法账号。若沿用原型的格式门槛，前端会拦掉
 * 后端实际支持的登录方式。账号是否存在、口令是否正确一律交由后端判定。
 */
export function checkAccount(value: string): FieldResult {
  if (!value.trim()) {
    return FAIL('请输入用户名或邮箱');
  }
  return PASS('', 'none');
}

/**
 * 密码：仅做必填校验，**不做长度门槛**（对原型的有意偏离）
 *
 * 原型要求 ≥8 位，但后端 `RegisterRequestSchema.password` 为 `min(6)`，
 * 系统内存在 6–7 位密码的合法账号；登录侧再叠加 8 位门槛会让这些账号无法登录。
 * 真正的安全边界是后端的 bcrypt 比对，前端不重复设限。
 */
export function checkPassword(value: string): FieldResult {
  if (!value) {
    return FAIL('密码为必填项');
  }
  return PASS('', 'none');
}

/** 手机号（验证码登录面板，本期面板为占位，规则先行落地） */
export function checkPhone(value: string, showOk = false): FieldResult {
  const v = value.trim();
  if (!v) {
    return FAIL('手机号为必填项');
  }
  if (!RE_MOBILE.test(v)) {
    return FAIL(`手机号需为 11 位中国大陆号码，当前 ${v.length} 位`);
  }
  return showOk ? PASS('✓ 手机号格式正确', 'ok') : PASS('', 'none');
}

/** 验证码（验证码登录面板，本期面板为占位，规则先行落地） */
export function checkCode(value: string, showOk = false): FieldResult {
  const v = value.trim();
  if (!v) {
    return FAIL('验证码为必填项');
  }
  if (!RE_CODE.test(v)) {
    return FAIL('验证码为 6 位数字');
  }
  return showOk ? PASS('✓ 验证码格式正确', 'ok') : PASS('', 'none');
}

/** 仅保留数字并截断到指定长度（原型 phone / code 输入时的过滤） */
export function digitsOnly(value: string, maxLength: number): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

/** 锁定剩余时间格式化：原型 formatLock —— 「X 分 YY 秒」 */
export function formatLock(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} 分 ${seconds < 10 ? '0' : ''}${seconds} 秒`;
}
