// ============================================================
// WelcomeHeader — 欢迎页标题区（极简居中风格）
// ============================================================
// 对齐参考图 + 用户偏好：
//   - 大字号居中标题，去掉图标装饰
//   - 副文字使用 muted 色、略收紧字距
//   - 上下留白适中，不做多余装饰
// ============================================================

export function WelcomeHeader() {
  return (
    <div className="flex flex-col items-center gap-2">
      <h1 className="text-3xl sm:text-[34px] font-bold tracking-tight text-center text-foreground leading-tight">
        Work with Pioneering AI
      </h1>
      <p className="text-sm text-muted-foreground text-center max-w-md leading-6">
        帮你整理论文综述、生成文档、分析数据、深度研究
      </p>
    </div>
  )
}
