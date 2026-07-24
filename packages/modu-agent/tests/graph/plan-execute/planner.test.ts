import { describe, it, expect } from 'vitest'
import { _inferRequiresTool } from '@/graph/plan-execute/planner.js'

describe('_inferRequiresTool', () => {
  it('识别天气类步骤为需要工具', () => {
    expect(_inferRequiresTool('获取北京今日天气数据', '查询北京今天的天气信息，包括气温、天气状况等')).toBe(true)
  })

  it('识别新闻类步骤为需要工具', () => {
    expect(_inferRequiresTool('获取最新新闻', '搜索今日新闻')).toBe(true)
  })

  it('识别价格/股票类步骤为需要工具', () => {
    expect(_inferRequiresTool('查询股价', '获取最新股票价格')).toBe(true)
  })

  it('识别日期/时间类步骤为需要工具', () => {
    expect(_inferRequiresTool('获取当前日期', '查询今天的日期')).toBe(true)
  })

  it('识别英文天气类步骤为需要工具', () => {
    expect(_inferRequiresTool('Get weather', 'Fetch today weather data')).toBe(true)
  })

  it('识别 API/网络请求类步骤为需要工具', () => {
    expect(_inferRequiresTool('调用API', '通过网络获取数据')).toBe(true)
  })

  it('不将纯总结类步骤判定为需要工具（基于前序结果）', () => {
    expect(_inferRequiresTool('总结今日天气特点', '基于获取的天气数据，用简洁的语言概括')).toBe(false)
  })

  it('不将纯穿衣建议类步骤判定为需要工具（根据前序结果）', () => {
    expect(_inferRequiresTool('给出穿衣建议', '根据气温推荐合适的着装')).toBe(false)
  })

  it('不将纯出行建议类步骤判定为需要工具（结合前序结果）', () => {
    expect(_inferRequiresTool('给出出行建议', '结合天气状况提供出行注意事项')).toBe(false)
  })
})
