# Tasks

- [x] Task 1: 建立审查基线与证据底账
  - [x] SubTask 1.1: 运行 build 确认 tsc 零错误，运行 test 记录基线测试结果（tsc exit 0；vitest 898 通过 / 7 失败，均为 sql-query better-sqlite3 环境问题；pnpm -F 因沙箱限制改用 node_modules/.bin 直调）
  - [x] SubTask 1.2: 生成全部 src 文件清单（153 文件 / 36,598 行），已作为报告附录底稿
- [x] Task 2: 深度审查 graph 模块（核心热点，最大模块）
  - [x] SubTask 2.1: 逐段深读 `src/graph/nodes.ts`（2685 行分 4 段读完）
  - [x] SubTask 2.2: 深读 runner/factory/graph/state/spec/termination-engine/context-strategies/prompt-templates
  - [x] SubTask 2.3: 审查 plan-execute/ 与 subgraph/
  - [x] SubTask 2.4: 审查 adapters/ 全部 14 文件
- [x] Task 3: 深度审查 core + config + kernel 模块（30 文件全部读取并交叉验证）
- [x] Task 4: 深度审查 perception + reasoning + memory 模块（33 文件全部读取）
- [x] Task 5: 深度审查 tools + mcp 模块（18 文件全部读取，五项安全专项逐一给论）
- [x] Task 6: 深度审查 orchestration + feedback + evolution + observability + skills（33 文件全部读取）
- [x] Task 7: 横向交叉审查（any 统计 114/777 处、logger 81 处、依赖逐项核实、Top10 巨型文件）
- [x] Task 8: 汇总撰写最终报告
  - [x] SubTask 8.1: 合并去重各任务发现（P0×7 / P1×26 / P2×43+），逐条五字段齐备
  - [x] SubTask 8.2: P0/P1/P2 排序 + 第七章路线图（三批实施、依赖关系标注）
  - [x] SubTask 8.3: 已产出 `packages/docs/modu-agent代码优化审查报告.md`，附录 B 含 153 文件逐一标注
- [x] Task 9: 回归验证
  - [x] SubTask 9.1: git status 与审查前完全一致（全部为用户既有未提交变更，审查期间 src/tests 零改动）
  - [x] SubTask 9.2: 重跑 build + test 与 Task 1 基线一致（tsc exit 0 零错误；vitest 898 通过 / 7 失败，失败均为 sql-query better-sqlite3 环境问题）

# Task Dependencies
- Task 1 是所有审查任务（2-6）的前置（需先确认基线）
- Task 2-6 相互独立，可并行执行
- Task 7 依赖 Task 2-6 完成（需各模块审查发现作为输入）
- Task 8 依赖 Task 2-7 全部完成
- Task 9 依赖 Task 8 完成
