# 桌面端 AI Agent 输入区（Composer）设计规范

> 对标对象：OpenAI Codex Desktop / Web、WorkBuddy、ChatGPT、Claude 桌面端对话输入区
> 技术栈：shadcn/ui + Radix UI（React + Tailwind CSS）
> 版本：v1.0 · 2026-07-08

---

## 1. 对标分析与设计目标

桌面端 AI Agent 输入区已形成稳定范式：**底部锚定、单卡片容器、左工具右发送**。主流产品的共性：

| 维度 | Codex | WorkBuddy | ChatGPT | Claude |
|---|---|---|---|---|
| 布局 | 底部 docked | 底部 docked | 底部居中 | 底部居中 |
| 发送键 | Enter | Enter | Enter | Enter |
| 换行 | Shift+Enter | Shift+Enter | Shift+Enter | Shift+Enter |
| 附件 | `+` / 拖拽 | 回形针 / 拖拽 | 回形针 / 拖拽 | 回形针 / 拖拽 |
| 生成态 | 停止按钮 | 停止按钮 | 停止方块 | 停止方块 |

**设计目标**：基于 shadcn/ui 设计令牌，产出一套语义清晰、可主题化（Light/Dark）、交互完整的输入区规范，前端可直接落地。

---

## 2. 整体布局结构

DOM 自上而下：

```
<Composer>                         // 居中卡片容器，max-w-[768px]，rounded-2xl，border + focus ring
  ├─ Attachments (条件渲染)         // 已上传文件 chips 行，gap-2
  ├─ Textarea                      // 多行、自适应高度、resize-none、min-h 24 / max-h 200
  └─ Toolbar (flex justify-between)
       ├─ Left：附件(Popover) + 模型选择 + 工具
       └─ Right：快捷键提示 + 发送/停止按钮
```

- 内容区居中，`max-width: 768px`，两侧留白 `px-4`
- 卡片距视口底部 `pb-6`（24px），形成悬浮感

---

## 3. 样式规范

### 3.1 颜色 Token（shadcn CSS 变量，主色用 Agent 紫）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--background` | `#FFFFFF` | `#0A0A0B` | Composer 表面 |
| `--foreground` | `#18181B` | `#FAFAFA` | 输入文字 |
| `--muted` | `#F4F4F5` | `#18181B` | 工具栏按钮底 / chip 底 |
| `--muted-foreground` | `#71717A` | `#A1A1AA` | 占位符 / 提示文字 |
| `--border` / `--input` | `#E4E4E7` | `#27272A` | Composer 描边 |
| `--primary` | `#6D28D9` | `#8B5CF6` | 发送按钮 / 聚焦环 |
| `--primary-hover` | `#5B21B6` | `#7C3AED` | hover |
| `--primary-active` | `#4C1D95` | `#6D28D9` | active |
| `--ring` | `rgba(109,40,217,.20)` | `rgba(139,92,246,.30)` | focus 环 |
| `--stop-bg` | `#18181B` | `#FAFAFA` | 停止按钮底 |
| `--stop-fg` | `#FFFFFF` | `#18181B` | 停止按钮图标 |

> 主色用 Agent 紫 `#6D28D9` 而非 shadcn 默认近黑，更贴合「AI 助手」心智；若已有品牌色，替换 `--primary` 系列即可。

### 3.2 字体字号

| 元素 | 字号 / 行高 | 字重 | 颜色 |
|---|---|---|---|
| 输入框正文 | `15px / 24px` | 400 | `--foreground` |
| 占位符 placeholder | `15px` | 400 | `--muted-foreground` |
| 附件 chip 文字 | `13px` | 400 | `#3F3F46`(L) / `#D4D4D8`(D) |
| 工具栏提示 | `12px / 16px` | 400 | `--muted-foreground` |
| 发送按钮图标 | `18px` | — | `#FFFFFF` |
| 字体栈 | `Inter, ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif` | | |

### 3.3 间距与圆角

- Composer 圆角 `16px`（rounded-2xl）；外边距 `pb-6`（24px）、`px-4`
- 内部 padding：textarea `px-4 py-3`；chip 区 `px-3 pt-3`；toolbar `px-3 pb-3`
- 工具栏按钮间距 `gap-1.5`（6px）；chip 间距 `gap-2`（8px）
- 发送按钮直径 `36px`（h-9 w-9），图标 18px，居中
- 附件按钮直径 `32px`（h-8 w-8）
- Textarea：`min-height 24px`，`max-height 200px`（超出内部滚动），`transition: height 120ms`

### 3.4 发送 / 停止按钮状态

| 状态 | 外观 | 交互 |
|---|---|---|
| Disabled | 灰底 `#E4E4E7` + 灰箭头，`cursor: not-allowed` | 空内容时 |
| Default | 紫底 `#6D28D9` + 白箭头 | 有内容 |
| Hover | `#5B21B6` | — |
| Active | `#4C1D95` + `scale(.94)` | 点击瞬间 |
| Focus-visible | 2px `--ring` 偏移 2px | 键盘聚焦 |
| Stop（生成中） | `--stop-bg` + 白色方块图标（代替箭头） | 点击中断生成 |

### 3.5 输入框交互状态

- **Default**：border `--input`
- **Hover**：border 略深（`#D4D4D8`）
- **Focus / focus-within**：border `--primary/50` + `ring-2 ring-[--ring]`，去掉默认 outline
- **Drag-over**：`border-primary` + `bg-primary/5`（拖拽文件进入高亮）
- **Disabled**：`bg-muted` + `text-muted-foreground`，不可输入

---

## 4. 交互能力

### 4.1 多行 + 自适应高度

```ts
const autoResize = () => {
  const el = ref.current; if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
};
useEffect(autoResize, [value]);   // 每次输入后重算
```

### 4.2 快捷键发送（桌面 Agent 标准）

```ts
const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    if (canSend) submit();      // Enter 发送
  }
  // Shift+Enter 走默认换行；可补：Cmd/Ctrl+Enter 发送、Esc 中断
};
```

> 中文输入法组合中（`isComposing`）必须放行，否则回车会误发。

### 4.3 附件上传

- 附件按钮用 `Popover`（Radix）展开「上传文件 / 上传图片 / 截图 / 知识库」
- 通过隐藏 `<input type="file" multiple>` 触发系统选择器
- 拖拽：`onDragOver` 设 `data-dragging` → 卡片高亮；`onDrop` 读取 `e.dataTransfer.files`
- 已上传文件渲染为 chip，含文件名 + 体积 + `✕` 移除

### 4.4 生成态切换

`isGenerating` 为真时，右侧按钮渲染为 Stop（方块图标），点击触发 `onStop`。

---

## 5. 前端参考实现（React + shadcn/ui + Radix UI）

```tsx
"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Paperclip, ArrowUp, Square } from "lucide-react";

type Attachment = { id: string; name: string; size: number };

export function Composer({
  onSend, onStop, isGenerating,
}: {
  onSend: (text: string, files: Attachment[]) => void;
  onStop: () => void;
  isGenerating?: boolean;
}) {
  const [value, setValue] = React.useState("");
  const [files, setFiles] = React.useState<Attachment[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const autoResize = React.useCallback(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);
  React.useEffect(autoResize, [value, autoResize]);

  const canSend = value.trim().length > 0 && !isGenerating;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim(), files);
    setValue(""); setFiles([]);
    requestAnimationFrame(() => ref.current && (ref.current.style.height = "auto"));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div
        className="rounded-2xl border border-input bg-background shadow-sm transition-colors
                   focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-[--ring]
                   data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/5"
        data-dragging={dragging}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); /* read e.dataTransfer.files */ }}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {f.name}
                <button onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))} className="hover:text-foreground">✕</button>
              </span>
            ))}
          </div>
        )}

        <Textarea
          ref={ref} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown} placeholder="给 WorkBuddy 发送消息…"
          className="max-h-[200px] min-h-[24px] resize-none border-0 bg-transparent px-4 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0"
          rows={1}
        />

        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-1.5">
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                      <Paperclip className="h-[18px] w-[18px]" />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>添加附件</TooltipContent>
              </Tooltip>
              <PopoverContent align="start" className="w-44">
                <button className="flex w-full rounded-md px-2 py-1.5 text-sm hover:bg-muted">上传文件</button>
                <button className="flex w-full rounded-md px-2 py-1.5 text-sm hover:bg-muted">上传图片</button>
                <button className="flex w-full rounded-md px-2 py-1.5 text-sm hover:bg-muted">截图</button>
              </PopoverContent>
            </Popover>
            {/* 模型 / 工具选择器放在此处 */}
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">Enter 发送 · Shift+Enter 换行</span>
            {isGenerating ? (
              <Button size="icon" className="h-9 w-9 rounded-full" style={{ background: "var(--stop-bg)", color: "var(--stop-fg)" }} onClick={onStop}>
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button size="icon" className="h-9 w-9 rounded-full" disabled={!canSend} onClick={submit}>
                <ArrowUp className="h-[18px] w-[18px]" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## 6. 暗色模式说明

集成时通过 `:root.dark`（或 `[data-theme="dark"]`）切换第 3.1 节 Token 即可，组件无需改动。关键差异：
- 表面与描边反相：`#FFFFFF/#E4E4E7` → `#0A0A0B/#27272A`
- 主色提亮：`#6D28D9` → `#8B5CF6`，保证暗底对比度
- 停止按钮反相：`--stop-bg/#--stop-fg` 互换

---

## 7. 交付清单

| 文件 | 说明 |
|---|---|
| `桌面端AI-Agent输入区设计规范.md` | 本规范文档 |
| `composer-prototype.html` | 可交互 HTML 原型（含自适应高度、快捷键、附件、生成态、Light/Dark） |

**已知边界**：原型中附件为本地文件选择/拖拽演示，未接后端上传；生成态为前端模拟。接入真实接口时替换 `onSend` / `onStop` 回调即可。
