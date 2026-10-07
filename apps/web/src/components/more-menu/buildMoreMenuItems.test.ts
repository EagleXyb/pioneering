/**
 * buildMoreMenuItems 单元测试（T4.5）
 */
import { describe, it, expect, vi } from 'vitest'
import { buildMoreMenuItems } from './buildMoreMenuItems'

describe('buildMoreMenuItems（T4.5）', () => {
  it('产出五组菜单，id 固定', () => {
    const items = buildMoreMenuItems({})
    expect(items.map((i) => i.id)).toEqual([
      'image',
      'file',
      'skill',
      'quote',
      'kb',
    ])
  })

  it('图片/文件组叶子含上传动作回调', () => {
    const onUploadImage = vi.fn()
    const onUploadFile = vi.fn()
    const items = buildMoreMenuItems({ onUploadImage, onUploadFile })

    const imageGroup = items.find((i) => i.id === 'image')!
    const fileGroup = items.find((i) => i.id === 'file')!

    const imageUpload = imageGroup.children!.find((c) => c.id === 'image-upload')!
    const fileUpload = fileGroup.children!.find((c) => c.id === 'file-upload')!

    imageUpload.onAction!()
    expect(onUploadImage).toHaveBeenCalledOnce()
    fileUpload.onAction!()
    expect(onUploadFile).toHaveBeenCalledOnce()
  })

  it('disabled=true 时叶子项标记禁用', () => {
    const items = buildMoreMenuItems({ disabled: true })
    for (const group of items) {
      for (const leaf of group.children ?? []) {
        expect(leaf.disabled).toBe(true)
      }
    }
  })

  it('未提供的回调为 undefined（点击仅关菜单，不报错）', () => {
    const items = buildMoreMenuItems({})
    const screenshot = items[0].children!.find((c) => c.id === 'image-screenshot')!
    expect(screenshot.onAction).toBeUndefined()
    expect(() => screenshot.onAction?.()).not.toThrow()
  })
})
