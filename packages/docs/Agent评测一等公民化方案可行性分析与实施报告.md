# Agent 评测一等公民化：方案可行性分析与实施报告

> 日期：2026-08-20
> 范围：`packages/evals`（新增评测工程）与 `packages/modu-agent`（最小侵入适配）
> 结论：**方案可行，且已实施落地并通过全量验证**

---

## 一、结论摘要

针对"将评测作为一等公民嵌入 Agent 项目（`evals/` 与 `agent/` 平级 + 分层评测架构 YAML 配置化）"的方案，经对 `pioneering` monorepo 现状的逐项核实，结论如下：

| # | 方案要点 | 结论 | 说明 |
|---|---------|------|------|
| 1 | `evals/` 与 `modu-agent/` 平级的顶层模块 | ✅ 可行，已实施 | monorepo workspaces 已声明 `packages/*` 通配，新增包自动纳入 |
| 2 | 分层评测架构（配置/数据/指标/门禁） | ✅ 可行，已实施 | 严格按"全局配置→数据构建→指标定义→门禁集成"四层落地 |
| 3 | 全部评测配置采用 YAML | ✅ 可行，已实施 | 复用根 `node_modules` 已 hoisted 的 `yaml@2.9.0`，零新增安装成本 |
| 4 | 配置支持引用与继承 | ✅ 可行，已实施 | 数据集 `sources` 多文件合并去重 + `${VAR:default}` 环境变量插值 |

**但原方案存在 4 个落地缺口，必须补强才能形成"评测与持续优化闭环"**（本次实施已全部补齐）：

1. **纯 YAML 目录不可运行**——`evals/` 必须是真正的 workspace 包（`package.json` + `src/` 评测引擎 + `tests/`），否则门禁只是"文档"而非"可执行契约"；
2. **`RuntimeConfig` 仅支持 JSON**——modu-agent 的 `RuntimeConfig.fromFile` 用 `JSON.parse`，YAML 配置需由 evals 包独立解析后经 `updateMany`/`overrideConfig` 桥接注入，而非改造 modu-agent 的配置体系；
3. **`run_sync` 不返回过程数据**——原返回仅含 `response/tool_results/trace_id`，过程层指标（token 成本/迭代效率）无从计算，需向后兼容地补充 `usage/iteration/reasoning_round_count`；
4. **项目无 CI 基础设施**——`ci_gates.yaml` 必须以 **CLI 退出码契约**（0=pass/warn，1=block）对接任意 CI 系统，而非绑定特定 CI。

---

## 二、与 modu-agent 现有工程的融合分析

评测能力嵌入的最大价值在于**复用而非重建**。modu-agent 已具备的能力与 evals 的复用关系：

| modu-agent 既有能力 | 位置 | evals 复用方式 |
|--------------------|------|---------------|
| `QualityMonitor`（rule/llm/hybrid 三模 LLM-as-Judge） | `feedback/quality-monitor.ts` | 输出层指标组直接实例化，`global.yaml` 的 `judge.*` 参数驱动 |
| `EfficiencyMetrics` / `AccuracyMetrics` | `feedback/metrics/` | 过程层指标的计算口径对齐 |
| `create_agent` / `run_sync` | `graph/factory.ts` / `graph/runner.ts` | 默认执行器经此驱动真实 Agent 图 |
| `RuntimeConfig` / `overrideConfig` | `config/runtime-config.ts` | `agent_overrides`（点分键）→ 嵌套对象 → 评测专用配置实例 |
| `_build_judge_llm` | `graph/factory.ts` | llm/hybrid 评判器 LLM 的统一构造 |
| `EvolutionSignal` / `EvolutionSignalCollector` | `feedback/evolution-signal.ts` | 评测失败 → 进化信号 → `ParameterTuneStrategy` 闭环 |
| `ModuAgentState`（usage/iteration/tool_results） | `graph/state.ts` | 过程层轨迹数据源（经 `run_sync` 新增字段透出） |

### 对 modu-agent 的唯一改动（向后兼容）

`graph/runner.ts` 的 `run_sync` 成功返回中新增 3 个字段（纯增量，不改变既有字段语义）：

```ts
data: {
  response, tool_results, trace_id,          // 既有
  usage: finalState['usage'] ?? {},          // 新增：token 成本
  iteration: finalState['iteration'] ?? 0,   // 新增：迭代轮数
  reasoning_round_count: ...,                // 新增：推理轮数
}
```

验证：modu-agent `tests/graph/` **183/183 通过**，无回归。

---

## 三、实施后的目录结构

```
packages/
├── modu-agent/                     # Agent 引擎（被测对象，未侵入）
├── evals/                          # ★ 评测工程（一等公民，与 modu-agent 平级）
│   ├── package.json                # workspace 包：@pioneering/evals
│   ├── tsconfig.json / tsconfig.build.json / vitest.config.ts
│   ├── config/
│   │   └── global.yaml             # 评测全局配置（标准/环境/judge/报告/闭环）
│   ├── data/
│   │   ├── datasets.yaml           # 数据集注册表（引用继承 + 采样策略）
│   │   ├── preprocessing.yaml      # 预处理规则（占位符钉死/截断/过滤）
│   │   └── cases/
│   │       ├── core.yaml           # 核心用例（6 条）
│   │       ├── edge.yaml           # 边界/对抗用例（含 draft 过滤示例）
│   │       └── regression.yaml     # 历史失败回归用例（失败即入库）
│   ├── metrics/
│   │   └── thresholds.yaml         # 分层指标树：阈值/权重/gate 级别
│   ├── gates/
│   │   └── ci_gates.yaml           # ci（PR 冒烟）与 release（发版）两档门禁
│   ├── src/                        # 评测引擎（对方案的必要补强）
│   │   ├── types.ts                # 核心类型（EvalCase/EvalReport/GateResult...）
│   │   ├── config-loader.ts        # YAML 加载 + ${VAR:default} 插值 + 校验
│   │   ├── dataset-loader.ts       # 数据集构建（合并/预处理/可复现采样）
│   │   ├── metrics.ts              # 三层指标组（output/process/system）
│   │   ├── agent-executor.ts       # 被测 Agent 执行器（YAML→RuntimeConfig 桥接）
│   │   ├── runner.ts               # 评测编排（并发池/超时/重试/聚合）
│   │   ├── report.ts               # 报告聚合 + baseline 回归对比
│   │   ├── gate.ts                 # 门禁评估（退出码契约）
│   │   ├── evolution-bridge.ts     # 评测失败 → EvolutionSignal 闭环
│   │   └── cli.ts                  # CLI（run/gate/datasets）
│   └── tests/                      # 6 个测试文件，47 个用例（fake executor，不依赖 LLM）
└── docs/
```

---

## 四、分层评测架构与 YAML Schema

### 4.1 全局配置（config/global.yaml）

| 配置段 | 作用 | 关键字段 |
|--------|------|---------|
| `agent_overrides` | 被测 Agent 配置覆盖 | 点分键（`llm.temperature` 等），执行前注入 `RuntimeConfig` |
| `env` | 执行环境变量 | `${VAR:default}` 插值，密钥不落盘 |
| `runner` | 执行参数 | `concurrency`（并发）、`timeout_ms`（单用例超时）、`retries` |
| `judge` | LLM-as-Judge | `mode: rule/llm/hybrid`，复用 `QualityMonitor` |
| `report` | 报告策略 | `output_dir`、`baseline: latest`（回归对比）、`keep_runs` |
| `evolution_bridge` | 进化闭环开关 | `min_quality_score`（信号触发线）、`severity` |

### 4.2 数据集注册（data/datasets.yaml）

```yaml
datasets:
  smoke:        # PR 冒烟
    sources: [{ file: cases/core.yaml }]
    sample: { strategy: all }
  full:         # 发版全量 = 三文件引用继承
    sources: [core, edge, regression 三文件]
  dev:          # 开发抽样：random + seed（可复现）
    sample: { strategy: random, n: 4, seed: 42 }
    filter: { exclude_tags: [draft] }
```

**引用继承机制**：多 `sources` 按 `id` 去重合并（后写覆盖）；**可复现性机制**：`seed` 驱动 mulberry32 确定性采样；**时间钉死机制**：`preprocessing.yaml` 将用例中的 `{{date}}` 替换为固定值，消除"今天"类用例的不可复现性。

### 4.3 指标树（metrics/thresholds.yaml）

三层 11 个指标，每个声明 `category/weight/threshold/gate`（`gate: block` 硬门禁 / `warn` 软告警 / `off` 仅观测）：

- **输出层**（复用 QualityMonitor）：`output_relevance / completeness / accuracy / confidence`
- **过程层**（轨迹分析）：`process_tool_success_rate / tool_coverage / redundant_calls（越低越好）/ recovery_rate / iteration_efficiency`
- **系统层**（端到端）：`system_task_success / ground_truth_match`（bigram Jaccard + 子串包含）

### 4.4 门禁（gates/ci_gates.yaml）

两档门禁，规则支持 `scope: dataset`（聚合值）与 `scope: delta`（相对 baseline 回归量）：

- **ci**（PR/push 触发）：smoke 集，`task_success ≥ 0.8` 等 3 条 block + 总分下降 ≤ 0.10 的 delta warn；
- **release**（发版）：full + regression 双数据集，`regression_failure_count ≤ 0`（历史失败用例零复发）。

---

## 五、评测与持续优化闭环

```
              ┌─────────────────────────────────────────────────┐
              │                  评测流水线                       │
              │  datasets.yaml 用例 → executor(真实 Agent 图)     │
              │  → 三层指标 → thresholds 判定 → EvalReport(JSON)  │
              │  → baseline delta（回归检测）                     │
              └───────────────┬─────────────────────────────────┘
                              │
              ┌───────────────┼──────────────────┐
              ▼               ▼                  ▼
        ci_gates.yaml    evolution-bridge    报告分析
        block→CI 拦截    失败用例→EvolutionSignal
                              │
                              ▼
              modu-agent 既有进化闭环（同构复用）
        EvolutionSignalCollector.getSignals()
              → ParameterTuneStrategy.analyzeAndAdjust()
              → config_overrides（下一轮生效）
              → 再评测验证（回到流水线顶部）
```

关键设计：评测侧进化信号与运行时 `feedback/evolution` 闭环**同构**——两者都产出 `EvolutionSignal` 并由同一 `ParameterTuneStrategy` 消费；区别是评测侧信号基于离线数据集（样本充足、可复现、可回归），运行时侧基于线上流量。

---

## 六、CI/CD 集成（退出码契约）

项目当前无 CI 基础设施，故门禁以 **CLI 退出码**为通用契约（与 CI 系统无关）：

```bash
cd packages/evals
npm run build
node dist/cli.js gate --gate ci    # 退出码 0=pass/warn，1=block，2=配置错误
```

GitHub Actions 接入示例（未来引入 CI 时直接可用）：

```yaml
# .github/workflows/agent-evals.yml
name: agent-evals
on: [pull_request]
jobs:
  evals-gate:
    runs-on: ubuntu-latest
    env:
      MODU_LLM_API_KEY: ${{ secrets.MODU_LLM_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build --workspace @pioneering/evals
      - run: node packages/evals/dist/cli.js gate --gate ci
      - uses: actions/upload-artifact@v4
        if: always()                       # block 时也上传失败报告
        with:
          name: eval-reports
          path: packages/evals/reports/
```

---

## 七、使用方式

```bash
# 列出数据集
node packages/evals/dist/cli.js datasets

# 跑冒烟评测（需 LLM API key；judge 默认 hybrid）
node packages/evals/dist/cli.js run --dataset smoke

# CI 门禁（先评测后评估，退出码对接 CI）
node packages/evals/dist/cli.js gate --gate ci

# 本地开发：不依赖 dist 的源码级测试（fake executor，无需 API key）
cd packages/evals && npx vitest run
```

---

## 八、验证结果

| 验证项 | 结果 |
|--------|------|
| evals 测试套件 | **47/47 通过**（6 文件：config-loader / dataset / metrics / report / gate / runner+evolution-bridge） |
| modu-agent 回归（`run_sync` 改动） | `tests/graph/` **183/183 通过** |
| TypeScript 编译（tsc strict） | 通过（`npx tsc -p tsconfig.build.json`） |
| CLI 端到端冒烟 | `datasets` 命令输出正确 |
| workspace 集成 | `npm install` 完成，`@pioneering/evals` 已入依赖树 |

测试设计要点：全部用 **fake executor**（脚本化 `AgentRunResult`）驱动，不产生 LLM 调用成本；覆盖超时（`withTimeout` 掐断）、引擎异常兜底（评测永不中断）、baseline delta、随机采样可复现、`higher_is_better=false` 指标、门禁 block/warn 分级与数据缺失降级。

---

## 九、后续演进建议

1. **失败即入库自动化**：在 CI 门禁评估后增加 `evals regress add <caseId>` 命令，将失败用例一键沉淀至 `cases/regression.yaml`（当前为手工沉淀）；
2. **生产流量回放**：从 `observability` 的 OTel trace 导出真实会话，脱敏后转为 `source: production` 用例；
3. **LLM 合成难例**：利用 judge LLM 对边界用例做对抗变异，扩充 `adversarial` 类别；
4. **评测看板**：`reports/*.json` 已含完整时序数据，可接 Grafana（复用 modu-agent 的 Prometheus 导出）可视化趋势；
5. **A/B 评测**：`runner` 支持双配置（两组 `agent_overrides`）对照跑分，支撑 prompt/模型选型决策。

---

## 附：本次变更清单

| 文件 | 变更类型 |
|------|---------|
| `packages/evals/**`（新增，21 文件） | 评测工程：6 个 YAML 配置 + 3 个用例文件 + 11 个引擎源文件 + 6 个测试文件 + 包配置 |
| `packages/modu-agent/src/graph/runner.ts` | `run_sync` 返回新增 `usage/iteration/reasoning_round_count`（向后兼容） |
| `package-lock.json` | workspace 纳入 `@pioneering/evals` |
