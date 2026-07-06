// ---- AboutSection ----
// 原 SettingsPage 中「关于」卡片内容，独立为设置弹框的一个分类区块。

export function AboutSection() {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">关于</h2>
      <p className="text-sm text-muted-foreground">
        Pioneering Desktop AI Agent v0.1.0
      </p>
      <p className="text-sm text-muted-foreground">
        Powered by Electron 42 · React 19 · LangGraph
      </p>
    </div>
  )
}
