// ============================================================
// select-list — Select 下拉状态机（纯逻辑，便于 node 环境单测）
//   职责：open / activeIdx（键盘导航 + 鼠标悬停共用高亮）的状态迁移。
//   值提交（onChange）与 DOM 渲染由组件层负责，不放入 reducer，
//   保证状态迁移可独立、无副作用地验证。
// ============================================================

export interface SelectListState {
  /** 下拉是否展开 */
  open: boolean
  /** 当前高亮项索引（键盘导航 + 鼠标悬停共用） */
  activeIdx: number
}

export type SelectListAction =
  | { type: 'OPEN'; selectedIndex: number }
  | { type: 'CLOSE' }
  | { type: 'HOVER'; index: number }
  | { type: 'ARROW_DOWN'; optionCount: number }
  | { type: 'ARROW_UP'; optionCount: number }
  | { type: 'ESC' }

export function selectListReducer(
  state: SelectListState,
  action: SelectListAction
): SelectListState {
  switch (action.type) {
    case 'OPEN':
      // 打开时把高亮重置到当前选中项（负数索引安全回退到 0）
      return { open: true, activeIdx: Math.max(0, action.selectedIndex) }
    case 'CLOSE':
    case 'ESC':
      // 关闭保留 activeIdx（下次打开会由 OPEN 重置）
      return { open: false, activeIdx: state.activeIdx }
    case 'HOVER':
      return { ...state, activeIdx: action.index }
    case 'ARROW_DOWN': {
      if (action.optionCount <= 0) return state
      return { ...state, activeIdx: (state.activeIdx + 1) % action.optionCount }
    }
    case 'ARROW_UP': {
      if (action.optionCount <= 0) return state
      return {
        ...state,
        activeIdx: (state.activeIdx - 1 + action.optionCount) % action.optionCount
      }
    }
    default:
      return state
  }
}
