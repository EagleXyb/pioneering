# Prompt 工程化体系架构设计

> 目标：搭建一套适配业务目标、可复用、可管控、可迭代、可观测的大模型业务落地体系，让大模型能力稳定、合规、规模化地嵌入业务流程。

---

## 一、体系全景架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        🖥️ Prompt 管理控制台 (Admin Portal)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Prompt   │ │ 版本与   │ │ 评测与   │ │ 发布与   │ │ 监控与   │    │
│  │ 工作台   │ │ 变更管理 │ │ 质量看板 │ │ 灰度管控 │ │ 运营大盘 │    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ RESTful API / gRPC
┌──────────────────────────────▼──────────────────────────────────────────┐
│                     ⚙️ Prompt 引擎层 (Core Engine)                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐      │
│  │ 模板渲染   │ │ 上下文组装 │ │ Chain 编排 │ │ Guardrail 守卫 │      │
│  │ (Renderer) │ │ (Assembler)│ │(Orchestrator)│ │  (安全合规)    │      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐      │
│  │ 变量注入   │ │ FewShot    │ │ 路由与降级 │ │ Token 预算管控 │      │
│  │ (Injector) │ │ 动态检索   │ │(Router)    │ │ (CostControl)  │      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│                    📦 Prompt 资产层 (Asset Registry)                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐      │
│  │ Prompt 仓库│ │ 变量字典   │ │ 评测数据集 │ │ 知识片段库     │      │
│  │ (Registry) │ │ (Vars)     │ │(Benchmark) │ │ (Snippets)     │      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐      │
│  │ 版本快照   │ │ 依赖关系图 │ │ 标签与分类 │ │ 权限与审批流   │      │
│  │ (Snapshot) │ │ (DAG)      │ │ (Tags)     │ │ (AccessControl)│      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│                  🔭 可观测层 (Observability)                             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐      │
│  │ 调用链追踪 │ │ 质量指标   │ │ 成本核算   │ │ 告警与自愈     │      │
│  │(Tracing)   │ │(Quality)   │ │(Billing)   │ │(Alert/Heal)    │      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────────┐
│                  🔌 业务集成层 (Integration)                             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────┐      │
│  │ SDK/API    │ │ Webhook    │ │ 消息队列   │ │ 低代码编排     │      │
│  │ 网关       │ │ 回调       │ │ 解耦       │ │(Flow Builder)  │      │
│  └────────────┘ └────────────┘ └────────────┘ └────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心概念模型

### 2.1 Prompt 资产模型

```yaml
Prompt:
  id: "prompt-xxx"                    # 全局唯一标识
  name: "daily-report-analyzer"       # 业务语义命名
  version: "2.1.0"                    # 语义化版本号
  status: "draft|review|staging|prod"  # 生命周期状态
  tags: ["日报分析", "NLU", "v2"]      # 标签分类
  owner: "team-ai"                    # 责任人/团队
  created_at: "2026-04-14"
  updated_at: "2026-04-14"

  # ─── 模板定义 ───
  template:
    system: |
      你是一位专业的{{domain}}数据分析师。
      分析风格：{{style}}
      输出格式：{{output_format}}
      约束：{{constraints}}
    user: |
      请分析以下{{domain}}数据：
      {{input_data}}
      要求：{{requirement}}

  # ─── 变量定义（强类型 + 约束） ───
  variables:
    domain:
      type: "enum"
      values: ["销售", "商务", "项目"]
      required: true
    style:
      type: "enum"
      values: ["简洁", "详细", "对比"]
      default: "简洁"
    output_format:
      type: "string"
      default: "Markdown表格"
    constraints:
      type: "string"
      default: "不超过500字"
    input_data:
      type: "text"
      required: true
      max_length: 8000
    requirement:
      type: "string"
      required: false

  # ─── 模型配置 ───
  model_config:
    provider: "openai"                 # 模型供应商
    model: "gpt-4o"                    # 模型标识
    temperature: 0.3
    max_tokens: 2048
    top_p: 0.9
    timeout_ms: 30000
    fallback_model: "gpt-4o-mini"      # 降级模型

  # ─── 守卫规则 ───
  guardrails:
    input_guard:
      - type: "pii_filter"             # PII 脱敏
      - type: "length_limit"           # 长度限制
        max: 8000
      - type: "content_filter"         # 内容安全
    output_guard:
      - type: "json_schema_validate"   # 输出格式校验
        schema: "daily_report_schema"
      - type: "content_filter"         # 输出安全
      - type: "hallucination_check"    # 幻觉检测

  # ─── 评测配置 ───
  evaluation:
    benchmark_dataset: "daily-report-v2"
    metrics: ["accuracy", "format_compliance", "latency_p95"]
    threshold:
      accuracy: 0.85
      format_compliance: 0.95
      latency_p95: 3000

  # ─── 发布策略 ───
  release_strategy:
    type: "canary"                     # canary | blue_green | rollout
    canary_ratio: 0.1                  # 10% 流量
    canary_duration: "24h"
    rollback_on:
      error_rate: 0.05
      latency_p99: 10000

  # ─── 依赖关系 ───
  dependencies:
    prompts: []                        # 依赖的其他 Prompt
    knowledge_bases: ["kb-domain-terms"]
    tools: ["data-query-tool"]
```

### 2.2 Prompt 组合模型（Chain / Workflow）

```yaml
PromptChain:
  id: "chain-daily-report-pipeline"
  name: "日报分析全流程"
  steps:
    - id: "extract"
      prompt_id: "daily-report-extractor"   # Step 1: 信息抽取
      output_key: "extracted_data"
      
    - id: "analyze"
      prompt_id: "daily-report-analyzer"    # Step 2: 深度分析
      input_mapping:
        input_data: "{{steps.extract.output.extracted_data}}"
      output_key: "analysis_result"
      
    - id: "summarize"
      prompt_id: "daily-report-summarizer"  # Step 3: 汇总输出
      input_mapping:
        analysis: "{{steps.analyze.output.analysis_result}}"
      output_key: "final_summary"
  
  error_handling:
    on_step_failure: "retry_with_fallback"  # retry | skip | abort
    max_retries: 2
```

---

## 三、分层架构详解

### 3.1 Prompt 管理控制台

管理端核心功能模块：

| 模块 | 功能 | 关键页面 |
|------|------|---------|
| **Prompt 工作台** | 创建/编辑/预览 Prompt 模板，变量配置，实时渲染预览 | 编辑器、Diff 视图、变量面板 |
| **版本与变更管理** | 版本发布、变更审批、Diff 对比、回滚操作 | 版本列表、审批流、变更日志 |
| **评测与质量看板** | 自动化评测、A/B 测试、质量指标可视化 | 评测报告、对比分析、趋势图 |
| **发布与灰度管控** | 灰度发布、流量分配、蓝绿部署、一键回滚 | 发布管理、流量配置、回滚中心 |
| **监控与运营大盘** | 调用量、延迟、成本、质量全链路看板 | 实时监控、成本报告、告警配置 |
| **知识与片段管理** | FewShot 样本库、知识片段、通用模板 | 片段库、样本管理、模板市场 |
| **权限与审批** | 团队权限、操作审批流、审计日志 | 角色管理、审批配置、操作日志 |

### 3.2 Prompt 引擎层

引擎层是整个体系的核心运行时，负责将模板转化为实际的大模型调用：

```
请求入口 → 变量注入 → 模板渲染 → 上下文组装 → Guardrail(入) → 模型调用 → Guardrail(出) → 响应返回
                                    ↑                                              ↓
                              FewShot 动态检索                              输出格式校验
                                    ↑                                              ↓
                              知识片段注入                                幻觉/安全检测
```

**各子模块职责：**

| 子模块 | 职责 | 关键能力 |
|--------|------|---------|
| **模板渲染 (Renderer)** | 将模板 + 变量渲染为完整 Prompt | Jinja2/Django 风格模板、条件逻辑、循环、嵌套 |
| **上下文组装 (Assembler)** | 组装 System/User/Assistant 消息序列 | 多轮上下文窗口管理、消息截断策略、优先级排序 |
| **Chain 编排 (Orchestrator)** | 多步 Prompt 串联/并联执行 | DAG 编排、条件分支、并行执行、错误恢复 |
| **Guardrail 守卫** | 输入输出安全合规 | PII 脱敏、内容过滤、格式校验、幻觉检测 |
| **变量注入 (Injector)** | 运行时变量绑定与校验 | 强类型校验、默认值、必填检查、枚举约束 |
| **FewShot 动态检索** | 按语义相似度选取示例 | 向量检索、多样性采样、Token 预算内优化 |
| **路由与降级 (Router)** | 模型选择与故障转移 | 负载均衡、延迟路由、降级链、熔断器 |
| **Token 预算管控** | 控制单次/单用户/单业务 Token 消耗 | 预算配额、滑动窗口限流、超限策略 |

### 3.3 Prompt 资产层

资产层是 Prompt 的持久化存储和治理核心：

```
Prompt 仓库 (Git-like 存储模型)
├── 名称空间 (Namespace)
│   ├── daily-report/                    # 业务域
│   │   ├── analyzer/
│   │   │   ├── v1.0.0 (snapshot)
│   │   │   ├── v2.0.0 (snapshot)
│   │   │   └── v2.1.0 (snapshot) ← current prod
│   │   └── summarizer/
│   └── customer-service/
│       └── intent-classifier/
├── 变量字典 (共享变量池)
├── 知识片段库 (可复用片段)
└── 评测数据集 (基准测试集)
```

**关键机制：**

- **版本快照**：每次发布生成不可变快照，支持任意版本回滚
- **依赖关系图**：Prompt 间依赖可视化，变更影响面分析
- **标签与分类**：业务域、能力类型、模型类型多维标签
- **权限与审批**：按名称空间隔离，发布需审批，操作留审计日志

### 3.4 可观测层

```
┌─────────────────────────────────────────────────────┐
│                   可观测三支柱                         │
│                                                      │
│  📊 Metrics          📝 Logging         🔗 Tracing   │
│  ├─ 调用 QPS         ├─ Prompt 完整快照  ├─ 链路ID    │
│  ├─ 延迟 P50/P95/P99 ├─ 变量实际值      ├─ 步骤耗时  │
│  ├─ Token 消耗       ├─ 模型原始响应    ├─ 依赖链路  │
│  ├─ 成功率/错误率     ├─ Guardrail 拦截  ├─ 降级路径  │
│  ├─ 质量评分          ├─ 异常堆栈        └─ 成本归因  │
│  └─ 成本趋势         └─ 审计操作                     │
│                                                      │
│  → 告警规则 → 自动降级 → 根因分析 → 持续优化           │
└─────────────────────────────────────────────────────┘
```

### 3.5 业务集成层

| 集成方式 | 适用场景 | 说明 |
|---------|---------|------|
| **SDK** | 后端服务集成 | Java/Python/Go SDK，一行代码调用 Prompt |
| **API 网关** | 跨系统调用 | RESTful API，支持认证、限流、熔断 |
| **Webhook** | 事件驱动 | Prompt 执行完成后回调业务系统 |
| **消息队列** | 异步解耦 | 适配高吞吐场景，结果通过 MQ 投递 |
| **低代码编排** | 业务人员配置 | 可视化拖拽编排 Prompt 流程 |

---

## 四、Prompt 核心研发流程

### 4.1 全生命周期流程

```
 ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
 │ 需求 │──▶│ 设计 │──▶│ 开发 │──▶│ 评测 │──▶│ 发布 │──▶│ 运营 │
 │ 分析 │   │ 建模 │   │ 迭代 │   │ 验证 │   │ 管控 │   │ 优化 │
 └──────┘   └──────┘   └──────┘   └──────┘   └──────┘   └──────┘
     │           │           │           │           │           │
     ▼           ▼           ▼           ▼           ▼           ▼
  业务目标    Prompt      模板编写     自动化      灰度发布     监控告警
  场景拆解    模型设计    变量定义     评测集      流量管控     质量巡检
  成功指标    变量规划    FewShot     人工评审     回滚策略     成本优化
  约束条件    守卫设计    Chain编排   回归测试     审批流程     版本迭代
```

### 4.2 Phase 1：需求分析 → Prompt 设计建模

**输入**：业务需求文档、场景描述

**关键活动**：

1. **场景拆解**：将业务需求拆解为原子 Prompt 任务
   ```
   业务需求："智能日报分析"
   ├── 任务1：日报内容抽取（结构化提取）
   ├── 任务2：工作项分类（意图分类）
   ├── 任务3：风险识别（信息抽取）
   └── 任务4：综合摘要（生成式摘要）
   ```

2. **确定评估指标**：每个任务定义可量化的成功标准
   | 任务 | 主指标 | 阈值 | 辅助指标 |
   |------|--------|------|---------|
   | 内容抽取 | F1 Score | ≥0.90 | 字段完整率 |
   | 工作项分类 | Accuracy | ≥0.85 | 混淆矩阵 |
   | 风险识别 | Recall | ≥0.95 | 误报率 |
   | 综合摘要 | ROUGE-L | ≥0.70 | 人工评分 |

3. **Prompt 模型设计**：
   - 选型：单轮 vs 多轮、单模型 vs 多模型协作
   - 变量规划：哪些是静态配置、哪些是动态注入
   - 守卫设计：输入输出需要哪些安全与质量关卡

**输出**：Prompt 设计文档（含场景拆解、变量规划、评估标准）

### 4.3 Phase 2：Prompt 开发迭代

**开发循环**：

```
编写模板 → 渲染预览 → 单元测试 → 调优优化 → 代码审查 → 提交版本
    ↑                                                    │
    └────────────── 不通过 ←──────────────────────────────┘
```

**1. 模板编写规范**：

```yaml
# 命名规范：<业务域>-<能力>-<版本>
name: "daily-report-analyzer-v2"

# 模板编写原则：
# ✅ DO:
#   - 角色定义清晰，说"你是什么"而非"你不是什么"
#   - 任务描述具体，包含输入、处理、输出的完整说明
#   - 约束条件显式，用正/负面示例消除歧义
#   - 输出格式结构化，提供模板或 schema
#   - 思维链引导，复杂任务要求 step-by-step
# ❌ DON'T:
#   - 模糊指令（"好好分析"、"尽量详细"）
#   - 过度约束（同时要求简洁又要求全面）
#   - 隐含假设（假设模型知道业务术语）
#   - 无边界任务（"分析一切可能的..."）
```

**2. 变量设计规范**：

```
变量分类：
├── 配置变量（Config）：运行时不变，随版本发布
│   ├── domain: "销售"
│   ├── style: "简洁"
│   └── output_format: "Markdown"
├── 上下文变量（Context）：每次调用可能不同，系统自动注入
│   ├── user_role: "部门经理"
│   ├── current_date: "2026-04-14"
│   └── org_context: "XX部门"
├── 业务变量（Business）：业务系统传入的核心数据
│   ├── input_data: "{{日报内容}}"
│   └── requirement: "{{用户需求}}"
└── 系统变量（System）：引擎自动注入
    ├── trace_id: "调用链ID"
    └── token_budget: "剩余Token预算"
```

**3. FewShot 策略**：

```
FewShot 管理方式：
├── 静态示例：随 Prompt 版本固定，适合稳定场景
├── 动态检索：按语义相似度从样本库选取，适合输入多变场景
│   ├── 检索策略：向量相似度 Top-K + 多样性采样
│   ├── Token 预算：动态示例总 Token 不超过上限
│   └── 更新机制：bad case 自动入库，定期清洗
└── 对比示例：正面 + 反面配对，适合格式/风格约束场景
```

**4. 单元测试**：

```python
# Prompt 单元测试示例
class TestDailyReportAnalyzer:
    def test_basic_extraction(self, prompt_runner):
        """基础抽取能力测试"""
        result = prompt_runner.run(
            prompt_id="daily-report-analyzer",
            version="2.1.0",
            variables={
                "domain": "销售",
                "input_data": "今日拜访客户3家，签订合同1份...",
                "style": "简洁"
            }
        )
        assert result.status == "success"
        assert result.output["client_visits"] == 3
        assert result.output["contracts"] == 1
        
    def test_empty_input_handling(self, prompt_runner):
        """空输入边界测试"""
        result = prompt_runner.run(
            prompt_id="daily-report-analyzer",
            version="2.1.0",
            variables={"domain": "销售", "input_data": ""}
        )
        assert result.status == "guardrail_blocked" or result.output is None
        
    def test_output_format_compliance(self, prompt_runner):
        """输出格式合规测试"""
        result = prompt_runner.run(
            prompt_id="daily-report-analyzer",
            version="2.1.0",
            variables={...}
        )
        assert validate_json_schema(result.output, "daily_report_schema")
```

### 4.4 Phase 3：评测验证

**评测体系四层模型**：

```
┌────────────────────────────────────────────────┐
│ Layer 4: 业务效果评测                            │
│   业务 KPI 达成率、用户满意度、转化率              │
├────────────────────────────────────────────────┤
│ Layer 3: 端到端评测                              │
│   完整 Prompt Chain 的效果、延迟、成本             │
├────────────────────────────────────────────────┤
│ Layer 2: 单 Prompt 质量评测                      │
│   准确率、格式合规率、安全合规率、幻觉率            │
├────────────────────────────────────────────────┤
│ Layer 1: 基础能力评测                            │
│   Token 消耗、延迟、吞吐、格式正确性              │
└────────────────────────────────────────────────┘
```

**自动化评测流水线**：

```
代码提交 → 自动触发 → 评测集运行 → 指标计算 → 质量门禁 → 结果报告
                         │
                    ┌────┴────┐
                    │ 评测集  │
                    ├─────────┤
                    │ 回归集  │  核心场景，必须全通过
                    │ 扩展集  │  边界/异常场景
                    │ 对抗集  │  安全/注入攻击测试
                    │ 性能集  │  延迟/成本基准
                    └─────────┘
```

**A/B 测试框架**：

```yaml
ab_test:
  name: "analyzer-v2-vs-v3"
  prompt_a: "daily-report-analyzer@2.1.0"
  prompt_b: "daily-report-analyzer@3.0.0"
  traffic_split: 50/50
  duration: "7d"
  metrics:
    primary: "accuracy"          # 主指标
    secondary: ["latency_p95", "cost_per_call", "format_compliance"]
  decision_rule: "bayesian"      # 贝叶斯决策
  min_sample_size: 1000          # 最小样本量
  significance_level: 0.05       # 显著性水平
```

### 4.5 Phase 4：发布管控

**发布流程**：

```
Draft → Review → Staging → Canary → Rollout → Prod
  │        │         │         │         │        │
  │        │         │         │         │        │
  编辑     代码审查   集成测试   灰度验证   全量发布  线上运行
  调试     安全审查   人工验证   指标对比   持续监控  持续优化
```

**灰度发布策略**：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **按比例灰度** | 10% → 30% → 50% → 100% 逐步放量 | 通用场景 |
| **按用户灰度** | 内部用户 → VIP用户 → 全量 | 用户敏感型业务 |
| **按地域灰度** | 单区域 → 多区域 → 全局 | 地域差异型业务 |
| **按流量灰度** | 低峰期验证 → 高峰期放量 | 流量敏感型业务 |

**自动回滚条件**：

```yaml
auto_rollback:
  triggers:
    - metric: "error_rate"
      threshold: 0.05          # 错误率超5%
      window: "5m"
    - metric: "latency_p99"
      threshold: 10000         # P99延迟超10s
      window: "5m"
    - metric: "guardrail_block_rate"
      threshold: 0.1           # 守卫拦截率超10%
      window: "10m"
    - metric: "quality_score"
      threshold: 0.8           # 质量评分低于0.8
      window: "30m"
```

### 4.6 Phase 5：运营优化

**持续优化闭环**：

```
监控发现 → Bad Case 分析 → 根因定位 → 优化方案 → 评测验证 → 版本发布
    ↑                                                        │
    └────────────────────────────────────────────────────────┘
```

**运营指标看板**：

| 维度 | 指标 | 告警阈值 |
|------|------|---------|
| 质量 | 格式合规率 | < 95% |
| 质量 | 内容准确率 | < 85% |
| 质量 | 幻觉率 | > 5% |
| 性能 | P95延迟 | > 5s |
| 性能 | 超时率 | > 1% |
| 成本 | 单次调用成本 | 偏差 > 20% |
| 成本 | 日总成本 | 超预算 |
| 安全 | 守卫拦截率 | > 5% |
| 安全 | 敏感信息泄露 | > 0 |

---

## 五、工程化封装落地

### 5.1 数据库核心 Schema

```sql
-- ========== Prompt 仓库 ==========
CREATE TABLE prompt_registry (
    id              VARCHAR(64) PRIMARY KEY,
    namespace       VARCHAR(128) NOT NULL,          -- 名称空间
    name            VARCHAR(256) NOT NULL,           -- Prompt 名称
    description     TEXT,
    owner           VARCHAR(128) NOT NULL,
    team            VARCHAR(128),
    tags            JSON,                            -- 标签数组
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(namespace, name)
);

-- ========== Prompt 版本 ==========
CREATE TABLE prompt_version (
    id              VARCHAR(64) PRIMARY KEY,
    prompt_id       VARCHAR(64) NOT NULL REFERENCES prompt_registry(id),
    version         VARCHAR(32) NOT NULL,            -- 语义化版本号
    semver_major    INT NOT NULL,
    semver_minor    INT NOT NULL,
    semver_patch    INT NOT NULL,
    
    -- 模板内容
    system_template TEXT,
    user_template   TEXT,
    assistant_prefix TEXT,                           -- 预填充
    
    -- 变量定义 (JSON Schema)
    variables_schema JSON NOT NULL,
    
    -- 模型配置
    model_config    JSON NOT NULL,                   -- {provider, model, temperature, ...}
    
    -- 守卫配置
    guardrails      JSON,                            -- 输入输出守卫规则
    
    -- 评测配置
    evaluation_config JSON,
    
    -- 发布策略
    release_strategy JSON,
    
    -- 依赖
    dependencies    JSON,                            -- 依赖的Prompt/知识库/工具
    
    -- 元数据
    status          VARCHAR(32) DEFAULT 'draft',     -- draft|review|staging|prod|deprecated
    changelog       TEXT,                            -- 变更说明
    created_by      VARCHAR(128),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(prompt_id, version)
);

CREATE INDEX idx_pv_prompt_status ON prompt_version(prompt_id, status);

-- ========== Prompt 快照（不可变） ==========
CREATE TABLE prompt_snapshot (
    id              VARCHAR(64) PRIMARY KEY,
    version_id      VARCHAR(64) NOT NULL REFERENCES prompt_version(id),
    snapshot_hash   VARCHAR(64) NOT NULL,            -- 内容哈希，防篡改
    content         JSON NOT NULL,                   -- 完整 Prompt 定义快照
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========== 知识片段库 ==========
CREATE TABLE prompt_snippet (
    id              VARCHAR(64) PRIMARY KEY,
    namespace       VARCHAR(128) NOT NULL,
    name            VARCHAR(256) NOT NULL,
    type            VARCHAR(32) NOT NULL,            -- fewshot|knowledge|instruction|constraint
    content         TEXT NOT NULL,
    tags            JSON,
    embedding       VECTOR(1536),                    -- 语义向量（用于动态检索）
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(namespace, name, type)
);

-- ========== 评测数据集 ==========
CREATE TABLE evaluation_dataset (
    id              VARCHAR(64) PRIMARY KEY,
    name            VARCHAR(256) NOT NULL,
    type            VARCHAR(32) NOT NULL,            -- regression|extension|adversarial|performance
    cases           JSON NOT NULL,                   -- 测试用例集
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========== 评测结果 ==========
CREATE TABLE evaluation_result (
    id              VARCHAR(64) PRIMARY KEY,
    version_id      VARCHAR(64) NOT NULL REFERENCES prompt_version(id),
    dataset_id      VARCHAR(64) NOT NULL REFERENCES evaluation_dataset(id),
    metrics         JSON NOT NULL,                   -- 评测指标结果
    passed          BOOLEAN NOT NULL,                -- 是否通过质量门禁
    detail          JSON,                            -- 逐条结果
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========== 调用日志 ==========
CREATE TABLE prompt_invocation_log (
    id              VARCHAR(64) PRIMARY KEY,
    trace_id        VARCHAR(64) NOT NULL,            -- 链路追踪ID
    prompt_id       VARCHAR(64) NOT NULL,
    version         VARCHAR(32) NOT NULL,
    snapshot_id     VARCHAR(64),                     -- 实际执行的快照
    
    -- 输入
    variables_input JSON NOT NULL,                   -- 变量输入值
    rendered_prompt JSON NOT NULL,                   -- 渲染后的完整 Prompt
    
    -- 输出
    model_response  TEXT,                            -- 模型原始响应
    parsed_output   JSON,                            -- 解析后的结构化输出
    
    -- 质量与安全
    guardrail_result JSON,                           -- 守卫检查结果
    quality_score   FLOAT,                           -- 质量评分
    
    -- 性能与成本
    model_provider  VARCHAR(64),
    model_name      VARCHAR(128),
    input_tokens    INT,
    output_tokens   INT,
    latency_ms      INT,
    cost_usd        FLOAT,
    
    -- 上下文
    caller_id       VARCHAR(128),                    -- 调用方标识
    user_id         VARCHAR(128),
    chain_id        VARCHAR(64),                     -- 所属 Chain
    
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invocation_prompt_time ON prompt_invocation_log(prompt_id, version, created_at);
CREATE INDEX idx_invocation_trace ON prompt_invocation_log(trace_id);

-- ========== 发布记录 ==========
CREATE TABLE prompt_release (
    id              VARCHAR(64) PRIMARY KEY,
    version_id      VARCHAR(64) NOT NULL REFERENCES prompt_version(id),
    environment     VARCHAR(32) NOT NULL,            -- staging|canary|prod
    strategy        JSON NOT NULL,                   -- 发布策略详情
    status          VARCHAR(32) DEFAULT 'pending',   -- pending|approved|releasing|completed|rolled_back
    approved_by     VARCHAR(128),
    released_by     VARCHAR(128),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME
);

-- ========== 审计日志 ==========
CREATE TABLE prompt_audit_log (
    id              VARCHAR(64) PRIMARY KEY,
    action          VARCHAR(64) NOT NULL,            -- create|update|delete|publish|rollback|approve
    resource_type   VARCHAR(32) NOT NULL,            -- prompt|version|snippet|dataset
    resource_id     VARCHAR(64) NOT NULL,
    operator        VARCHAR(128) NOT NULL,
    detail          JSON,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 核心 API 设计

```
Prompt 仓库 API:
├── POST   /api/v1/prompts                    # 创建 Prompt
├── GET    /api/v1/prompts                    # 列表查询（支持筛选/分页）
├── GET    /api/v1/prompts/{id}               # 获取详情
├── PUT    /api/v1/prompts/{id}               # 更新元信息
├── DELETE /api/v1/prompts/{id}               # 删除（软删除）
│
Prompt 版本 API:
├── POST   /api/v1/prompts/{id}/versions      # 创建版本
├── GET    /api/v1/prompts/{id}/versions      # 版本列表
├── GET    /api/v1/prompts/{id}/versions/{v}  # 版本详情
├── POST   /api/v1/prompts/{id}/versions/{v}/submit     # 提交审查
├── POST   /api/v1/prompts/{id}/versions/{v}/approve    # 审批通过
├── POST   /api/v1/prompts/{id}/versions/{v}/reject     # 审批驳回
│
Prompt 渲染 API:
├── POST   /api/v1/render                     # 渲染预览（不入库）
├── POST   /api/v1/invoke                     # 执行调用（生产入口）
│
Prompt 评测 API:
├── POST   /api/v1/evaluations                # 创建评测任务
├── GET    /api/v1/evaluations/{id}           # 评测结果
├── POST   /api/v1/ab-tests                   # 创建 A/B 测试
├── GET    /api/v1/ab-tests/{id}              # A/B 测试结果
│
Prompt 发布 API:
├── POST   /api/v1/releases                   # 创建发布
├── GET    /api/v1/releases/{id}              # 发布状态
├── POST   /api/v1/releases/{id}/rollback     # 回滚
│
知识片段 API:
├── POST   /api/v1/snippets                   # 创建片段
├── GET    /api/v1/snippets                   # 查询片段
├── POST   /api/v1/snippets/search            # 语义检索
│
监控 API:
├── GET    /api/v1/metrics/overview           # 全局概览
├── GET    /api/v1/metrics/prompt/{id}        # 单 Prompt 指标
├── GET    /api/v1/metrics/cost               # 成本报告
├── GET    /api/v1/invocations                # 调用日志查询
```

### 5.3 SDK 封装

```python
# Python SDK 设计
from prompt_engine import PromptClient, PromptConfig

# 初始化客户端
client = PromptClient(
    endpoint="https://prompt-engine.internal/api/v1",
    api_key="xxx",
    timeout=30
)

# ─── 基础调用 ───
result = client.invoke(
    prompt_id="daily-report-analyzer",
    version="2.1.0",                    # 可选，默认生产版本
    variables={
        "domain": "销售",
        "input_data": "今日拜访客户3家...",
        "style": "简洁"
    }
)

# ─── 流式调用 ───
for chunk in client.invoke_stream(
    prompt_id="daily-report-analyzer",
    variables={...}
):
    print(chunk.content, end="")

# ─── Chain 调用 ───
result = client.invoke_chain(
    chain_id="daily-report-pipeline",
    variables={
        "input_data": "日报内容..."
    }
)

# ─── 带守卫回调 ───
result = client.invoke(
    prompt_id="daily-report-analyzer",
    variables={...},
    on_guardrail_block=lambda event: handle_block(event),
    on_fallback=lambda model: log_fallback(model)
)

# ─── A/B 测试调用 ───
result = client.invoke(
    prompt_id="daily-report-analyzer",
    experiment="analyzer-v2-vs-v3",       # 自动按实验配置分流
    variables={...}
)

# ─── 渲染预览 ───
preview = client.render(
    prompt_id="daily-report-analyzer",
    version="3.0.0",
    variables={...}
)
print(preview.system_message)
print(preview.user_message)
print(preview.estimated_tokens)
```

### 5.4 Guardrail 实现架构

```
输入 Guardrail Pipeline:
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ PII 检测 │──▶│ 内容安全 │──▶│ 长度限制 │──▶│ 注入防御 │
│ (脱敏)   │   │ (过滤)   │   │ (截断)   │   │ (检测)   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                       │
                                                   通过/拦截
                                                       │
                                                       ▼
                                              ┌──────────────┐
                                              │  模型调用     │
                                              └──────────────┘
                                                       │
                                                       ▼
输出 Guardrail Pipeline:
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 格式校验 │──▶│ 内容安全 │──▶│ 幻觉检测 │──▶│ 敏感信息 │
│ (Schema) │   │ (过滤)   │   │ (比对)   │   │ (脱敏)   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                       │
                                                   通过/拦截
                                                       │
                                                       ▼
                                              ┌──────────────┐
                                              │  返回结果     │
                                              └──────────────┘
```

**Guardrail 插件化设计**：

```python
# Guardrail 插件接口
class BaseGuardrail(ABC):
    @abstractmethod
    def check(self, content: str, context: dict) -> GuardResult:
        """检查内容，返回通过/拦截/修改结果"""
        pass

# 示例：PII 脱敏守卫
class PIIGuardrail(BaseGuardrail):
    def check(self, content: str, context: dict) -> GuardResult:
        pii_entities = self.detect_pii(content)
        if pii_entities:
            sanitized = self.redact(content, pii_entities)
            return GuardResult(
                action="modify",           # 修改后放行
                modified_content=sanitized,
                details={"redacted": pii_entities}
            )
        return GuardResult(action="pass")

# 示例：格式校验守卫
class SchemaGuardrail(BaseGuardrail):
    def check(self, content: str, context: dict) -> GuardResult:
        schema = context.get("output_schema")
        try:
            parsed = json.loads(content)
            jsonschema.validate(parsed, schema)
            return GuardResult(action="pass", parsed_output=parsed)
        except (json.JSONDecodeError, jsonschema.ValidationError) as e:
            return GuardResult(
                action="block",
                reason=f"格式校验失败: {e}",
                suggestion="retry_with_format_hint"   # 建议重试并强化格式指令
            )
```

---

## 六、管理控制台功能规格

### 6.1 页面结构

```
Prompt 管理控制台
│
├── 📋 工作台
│   ├── Prompt 列表（卡片/列表视图切换）
│   ├── 快速搜索（名称/标签/命名空间）
│   ├── 新建 Prompt（引导式/高级模式）
│   └── 最近编辑 / 我收藏的
│
├── ✏️ 编辑器
│   ├── 模板编辑（代码编辑器 + 语法高亮）
│   ├── 变量配置面板（类型、约束、默认值）
│   ├── 模型参数配置
│   ├── 守卫规则配置
│   ├── 实时渲染预览
│   ├── Diff 对比（版本间）
│   └── 评测数据集关联
│
├── 📊 评测中心
│   ├── 评测数据集管理
│   ├── 评测任务列表
│   ├── 评测报告查看
│   ├── A/B 测试管理
│   └── 质量趋势看板
│
├── 🚀 发布中心
│   ├── 发布流程管理
│   ├── 灰度配置
│   ├── 流量分配
│   ├── 回滚操作
│   └── 发布日历
│
├── 📈 监控中心
│   ├── 全局概览大盘
│   ├── 单 Prompt 详情
│   ├── 调用日志查询
│   ├── 成本分析
│   └── 告警管理
│
├── 📚 知识库
│   ├── 片段管理
│   ├── FewShot 样本库
│   ├── 通用模板市场
│   └── 变量字典
│
└── ⚙️ 系统设置
    ├── 命名空间管理
    ├── 团队与权限
    ├── 审批流配置
    ├── 模型供应商配置
    └── 审计日志
```

### 6.2 编辑器核心交互

```
┌─────────────────────────────────────────────────────────────────┐
│ daily-report-analyzer  v2.1.0  [Draft ▼]       [预览] [保存]    │
├─────────────────────────────┬───────────────────────────────────┤
│                             │                                   │
│  模板编辑区                  │  变量配置面板                      │
│                             │                                   │
│  System:                    │  ┌─ domain ─────────────────┐    │
│  你是一位专业的{{domain}}    │  │ 类型: enum               │    │
│  数据分析师。                │  │ 值: [销售,商务,项目]      │    │
│  分析风格：{{style}}         │  │ 必填: ✓                   │    │
│  输出格式：{{output_format}} │  └──────────────────────────┘    │
│                             │  ┌─ style ──────────────────┐    │
│  User:                      │  │ 类型: enum               │    │
│  请分析以下{{domain}}数据：  │  │ 值: [简洁,详细,对比]      │    │
│  {{input_data}}             │  │ 默认: 简洁                │    │
│  要求：{{requirement}}       │  └──────────────────────────┘    │
│                             │  ┌─ input_data ─────────────┐    │
│                             │  │ 类型: text               │    │
│                             │  │ 必填: ✓  最大: 8000      │    │
│                             │  └──────────────────────────┘    │
│                             │                                   │
│                             │  [+ 添加变量]                     │
│                             │                                   │
├─────────────────────────────┴───────────────────────────────────┤
│                                                                 │
│  渲染预览                                                       │
│                                                                 │
│  System: 你是一位专业的【销售】数据分析师。分析风格：简洁。       │
│  输出格式：Markdown表格。                                        │
│                                                                 │
│  User: 请分析以下【销售】数据：今日拜访客户3家，签订合同1份...    │
│                                                                 │
│  预估 Token: 286 / 2048    预估成本: $0.0043                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、技术选型建议

| 层级 | 组件 | 推荐选型 | 说明 |
|------|------|---------|------|
| **管理控制台** | 前端框架 | React + Ant Design Pro | 企业级后台最佳实践 |
| **API 网关** | 网关 | Kong / APISIX | 认证、限流、熔断 |
| **业务服务** | 后端框架 | Python FastAPI / Java Spring Boot | 根据团队技术栈选择 |
| **Prompt 存储** | 关系数据库 | PostgreSQL + pgvector | 主存储 + 向量检索 |
| **缓存** | Redis | Redis Cluster | 热点 Prompt 缓存、限流计数 |
| **消息队列** | Kafka / RabbitMQ | 按规模选择 | 异步评测、调用日志 |
| **可观测** | Prometheus + Grafana | 标准可观测栈 | 指标采集与可视化 |
| **链路追踪** | OpenTelemetry + Jaeger | 标准追踪栈 | Prompt 调用链追踪 |
| **日志** | ELK Stack | Elasticsearch + Kibana | 调用日志存储与分析 |
| **向量数据库** | Milvus / Qdrant | 知识片段语义检索 | FewShot 动态检索 |

---

## 八、落地路线图

```
Phase 1 (MVP, 4-6周)
├── Prompt 仓库 + 版本管理（CRUD + 版本快照）
├── 模板渲染引擎（变量注入 + 模板渲染）
├── 管理控制台基础版（编辑器 + 列表 + 版本对比）
├── 调用 API + Python SDK
└── 基础监控（调用量、延迟、错误率）

Phase 2 (质量体系, 4-6周)
├── Guardrail 守卫框架（输入输出管道）
├── 自动化评测流水线
├── A/B 测试框架
├── 评测数据集管理
└── 质量看板

Phase 3 (发布管控, 3-4周)
├── 灰度发布引擎
├── 发布审批流
├── 自动回滚
├── 审计日志
└── 权限管理

Phase 4 (高级能力, 持续迭代)
├── Chain 编排引擎
├── FewShot 动态检索
├── 知识片段管理
├── 成本核算与优化
├── 低代码编排
└── 模板市场
```

---

## 九、关键设计原则

| 原则 | 体现 |
|------|------|
| **Prompt as Code** | Prompt 版本化、代码化、可 Diff、可 Review |
| **Fail Safe** | 守卫拦截、降级兜底、自动回滚，任何异常不裸奔 |
| **可观测先行** | 每次调用完整记录，质量问题可回溯、可归因 |
| **渐进式发布** | 灰度放量 + 指标门禁，小步快跑降低风险 |
| **数据驱动** | 评测集 + 质量指标 + A/B 测试，用数据说话而非直觉 |
| **关注点分离** | 模板与变量分离、Prompt 与模型配置分离、业务与引擎分离 |
| **最小权限** | 变量强类型约束、守卫白名单、操作审批流 |

---

> **总结**：这套 Prompt 工程化体系的核心思想是 —— **把 Prompt 当作软件工程对象来管理**。它不是一段随意拼凑的文本，而是一个有版本、有类型、有测试、有发布流程的工程资产。只有建立了这套工程化基础设施，大模型能力才能真正从"能用"走向"好用"和"敢用"，稳定、合规、规模化地嵌入业务流程。
