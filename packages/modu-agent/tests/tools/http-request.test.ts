// P0-4：SSRF 防护 IPv6 绕过回归。
//
// 原缺陷：WHATWG URL 会把 http://[::ffff:10.0.0.1]/ 规范化为 [::ffff:a00:1]，
// 旧的内嵌 IPv4 正则只匹配点分十进制，十六进制映射形态被当作"公网 IPv6"放行。
import { describe, it, expect } from 'vitest'

import { HttpRequestTool } from '@/tools/http-request.js'
import { parseIpv6Groups } from '@/tools/http-request.js'

describe('P0-4 · parseIpv6Groups IPv6 展开', () => {
  it('展开 :: 压缩形式为 8 组', () => {
    expect(parseIpv6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIpv6Groups('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIpv6Groups('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])
  })

  it('末尾点分内嵌 IPv4 转换为两组十六进制', () => {
    // ::ffff:10.0.0.1 → a00:0001
    expect(parseIpv6Groups('::ffff:10.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0a00, 0x0001])
    // 64:ff9b::10.0.0.1
    expect(parseIpv6Groups('64:ff9b::10.0.0.1')).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 1])
  })

  it('支持方括号与 zone id', () => {
    expect(parseIpv6Groups('[fe80::1%eth0]')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
  })

  it('畸形输入返回 null 且不抛错', () => {
    expect(parseIpv6Groups('::g1')).toBeNull()
    expect(parseIpv6Groups('1::2::3')).toBeNull()
    expect(parseIpv6Groups('1:2:3')).toBeNull()
  })
})

describe('P0-4 · _isPrivateIp SSRF 绕过封堵', () => {
  const tool = new HttpRequestTool() as any
  const isPrivate = (ip: string): boolean => tool._isPrivateIp(ip)

  // —— 报告指定的四个核心绕过形态（WHATWG URL 规范化后的十六进制形式）——
  const mappedPrivate = [
    '::ffff:0a00:0001', // v4-mapped 完整十六进制（10.0.0.1）
    '::ffff:a00:1',     // v4-mapped 压缩十六进制
    '::a00:1',          // v4-compatible（::/96）
    '64:ff9b::a00:1',   // NAT64 知名前缀（64:ff9b::/96）
  ]

  it.each(mappedPrivate)('%s 映射内网地址 → 判定为私网', (ip) => {
    expect(isPrivate(ip)).toBe(true)
  })

  it('点分十进制内嵌形态（旧路径）仍判定为私网', () => {
    expect(isPrivate('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivate('::10.0.0.1')).toBe(true)
    expect(isPrivate('64:ff9b::10.0.0.1')).toBe(true)
  })

  it('映射到公网 IPv4 的各种形态 → 放行（不误伤）', () => {
    expect(isPrivate('::ffff:8.8.8.8')).toBe(false)
    expect(isPrivate('::ffff:0808:0808')).toBe(false)
    expect(isPrivate('64:ff9b::808:808')).toBe(false)
    expect(isPrivate('::808:808')).toBe(false)
  })

  it('普通公网 IPv6 → 放行', () => {
    expect(isPrivate('2606:4700:4700::1111')).toBe(false)
    expect(isPrivate('2001:4860:4860::8888')).toBe(false)
  })

  it('IPv6 保留地址 → 私网（回环/未指定/ULA/链路本地/6to4）', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '2002::1', '[fe80::1]']) {
      expect(isPrivate(ip)).toBe(true)
    }
  })

  it('纯 IPv4 判定不回归', () => {
    expect(isPrivate('10.0.0.1')).toBe(true)
    expect(isPrivate('192.168.1.1')).toBe(true)
    expect(isPrivate('127.0.0.1')).toBe(true)
    expect(isPrivate('8.8.8.8')).toBe(false)
  })

  it('畸形/非 IP 输入不抛未捕获异常', () => {
    expect(() => isPrivate('zz::1')).not.toThrow()
    expect(isPrivate('zz::1')).toBe(false)
    expect(isPrivate('not-an-ip')).toBe(false)
  })

  it('端到端：WHATWG URL 规范化 [::ffff:10.0.0.1] 后仍被识别（真实攻击向量）', () => {
    // 复现报告中的规范化：点分内嵌 → 十六进制主机名
    const hostname = new URL('http://[::ffff:10.0.0.1]/').hostname
    expect(hostname).toContain(':')
    expect(isPrivate(hostname)).toBe(true)
  })
})
