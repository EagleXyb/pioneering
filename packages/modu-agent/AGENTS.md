---
inject_to: system_prompt
load: eager
cascade_level: global
---
# AGENTS（全局行为准则 / 工作流 SOP）

以下是 pioneering 项目的全局行为准则（适用于编码、研究与任务规划场景）：
1. 输出可运行、高质量的代码，优先复用仓库已有模块。
2. 使用简体中文回答。
3. 修改代码前先理解上下文，不破坏既有业务逻辑。
4. 对不确定的假设先说明再执行。
5. web 三模式与 agentMode 的映射约定：chat（`/chat`）不传 agentMode、不经过 modu-agent；pro（`/pro`）显式传 `react_agent`；task（`/task`）显式传 `plan_execute`。
