# ReAct 模式的业务定制化优化：深度指南

---

## 一、TAO 循环在特定业务场景中的精细化编排

### 1.1 Thought 阶段：推理深度控制

#### 核心问题
Thought 阶段过浅会导致"盲目行动"（反复试错），过深则导致"分析瘫痪"（token浪费 + 延迟增加）。关键在于**动态适配推理深度**。

#### 策略 A：分层推理框架（Tiered Reasoning）

将 Thought 阶段分为三个层级，根据任务复杂度自动选择：

```
┌─────────────────────────────────────────────────────────┐
│  Tier-1 (快速响应)    → 直接映射型任务                    │
│  适用于：明确意图 + 单一工具 + 无歧义                     │
│  Thought 预算：1轮，直接输出 Action                      │
├─────────────────────────────────────────────────────────┤
│  Tier-2 (标准推理)    → 需要分解的复合型任务               │
│  适用于：多步骤 + 工具组合 + 有条件分支                   │
│  Thought 预算：2-4轮，包含分解→规划→验证                  │
├─────────────────────────────────────────────────────────┤
│  Tier-3 (深度推理)    → 高风险/高复杂度任务                │
│  适用于：不确定性高 + 需多源验证 + 决策影响大              │
│  Thought 预算：5+轮，包含假设→验证→反思→修正              │
└─────────────────────────────────────────────────────────┘
```

**实现方式 — 复杂度评估 Prompt：**

```python
COMPLEXITY_ASSESSMENT_PROMPT = """
分析用户任务，输出复杂度评估：

任务：{user_query}

评估维度：
1. 步骤数量：单步(1) / 多步(2-4) / 复杂流程(5+)
2. 工具依赖：无工具(0) / 单工具(1) / 多工具组合(2+)
3. 不确定性：确定性高(1) / 部分不确定(2) / 高度不确定(3)
4. 风险等级：低(1) / 中(2) / 高(3)

输出格式：
{{
  "tier": "tier_1 | tier_2 | tier_3",
  "reasoning_budget": <最大Thought轮数>,
  "decomposition": ["子任务1", "子任务2", ...],
  "confidence_threshold": <最低可接受置信度 0.0-1.0>
}}
"""
```

#### 策略 B：思维链锚点（Chain-of-Thought Anchors）

在 Thought 阶段强制插入结构化"锚点"，防止推理偏移：

```
Thought 锚点模板：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 当前目标：[本轮要解决的具体问题]
📍 已知信息：[从 Observation 中提取的关键事实]
📍 缺失信息：[还需要获取什么]
📍 下一步计划：[打算调用什么工具/做什么]
📍 预期结果：[期望得到什么]
📍 风险预判：[可能出错的地方]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**业务场景示例 — 金融风控审核 Agent：**

```
Thought #1:
📍 当前目标：评估该笔交易的欺诈风险
📍 已知信息：交易金额50万，收款方为新增账户，交易时间凌晨3点
📍 缺失信息：收款方历史交易记录、用户近期行为模式
📍 下一步计划：调用「用户画像查询」和「收款方风险评估」两个工具
📍 预期结果：获取用户风险评分和收款方可信度
📍 风险预判：如果工具返回超时，需要有降级策略
```

#### 策略 C：反思式推理（Reflective Reasoning）

在每个 Thought 轮次末尾增加自我验证：

```python
REFLECTION_SUFFIX = """
在确定下一步Action之前，请回答：
1. 我当前的推理是否存在逻辑跳跃？
2. 是否有更高效的工具选择？
3. 如果当前计划失败，备选方案是什么？
只有当以上问题都有满意答案时，才输出Action。
"""
```

---

### 1.2 Action 阶段：工具选择策略

#### 策略 A：工具能力矩阵 + 意图路由

构建结构化的工具注册表，配合意图分类实现精准路由：

```python
TOOL_REGISTRY = {
    "data_query": {
        "tools": ["sql_executor", "api_data_fetch", "knowledge_base_search"],
        "selection_logic": {
            "结构化数据查询": "sql_executor",
            "外部API数据": "api_data_fetch", 
            "非结构化知识": "knowledge_base_search"
        },
        "fallback_chain": ["sql_executor", "api_data_fetch", "knowledge_base_search"]
    },
    "data_analysis": {
        "tools": ["python_executor", "statistical_analyzer", "chart_generator"],
        "selection_logic": {
            "数值计算": "python_executor",
            "统计检验": "statistical_analyzer",
            "可视化": "chart_generator"
        }
    },
    "action_execution": {
        "tools": ["email_sender", "workflow_trigger", "approval_submitter"],
        "requires_confirmation": True,
        "confirmation_threshold": 0.85  # 置信度低于此值需人工确认
    }
}
```

#### 策略 B：动态工具编排（Dynamic Tool Orchestration）

```
┌────────────────────────────────────────────────────┐
│              工具编排引擎                            │
│                                                    │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐   │
│  │ 串行执行  │     │ 并行执行  │     │ 条件分支  │   │
│  │ A→B→C    │     │ A┬B┬C    │     │ A→(B|C)  │   │
│  └──────────┘     └──────────┘     └──────────┘   │
│                                                    │
│  选择依据：                                         │
│  • 工具间是否有数据依赖 → 串行                       │
│  • 工具间是否相互独立 → 并行（降低延迟）              │
│  • 工具选择是否取决于前置结果 → 条件分支              │
└────────────────────────────────────────────────────┘
```

**实现示例 — 智能客服 Agent 的工具编排：**

```python
def orchestrate_tools(task_decomposition, tool_registry):
    """根据任务分解结果，生成工具执行计划"""
    
    execution_plan = {
        "parallel_groups": [],   # 可并行执行的工具组
        "sequential_steps": [],  # 必须串行执行的步骤
        "conditional_branches": []  # 条件分支
    }
    
    for subtask in task_decomposition:
        matched_tools = match_tools(subtask, tool_registry)
        
        if subtask.has_dependency:
            # 有数据依赖，必须串行
            execution_plan["sequential_steps"].append({
                "tool": matched_tools[0],
                "depends_on": subtask.dependency_id,
                "input_transform": subtask.input_mapping
            })
        elif subtask.is_conditional:
            # 条件分支
            execution_plan["conditional_branches"].append({
                "condition": subtask.condition,
                "if_true": matched_tools[0],
                "if_false": matched_tools[1]
            })
        else:
            # 独立任务，可并行
            execution_plan["parallel_groups"].append(matched_tools)
    
    return execution_plan
```

#### 策略 C：工具调用的安全防护

```python
ACTION_GUARDRAILS = {
    # 写操作保护
    "write_operations": {
        "tools": ["sql_executor", "email_sender", "approval_submitter"],
        "protection": {
            "dry_run_first": True,          # 先预览影响范围
            "impact_assessment": True,       # 评估影响
            "human_confirmation": "auto",    # 自动判断是否需要人工确认
            "rollback_plan": True            # 要求提供回滚方案
        }
    },
    # 敏感数据保护
    "sensitive_data": {
        "tools": ["sql_executor", "api_data_fetch"],
        "protection": {
            "data_masking": True,            # 返回数据脱敏
            "access_logging": True,          # 记录访问日志
            "row_limit": 100,                # 限制返回行数
            "column_whitelist": ["id", "name", "status"]  # 字段白名单
        }
    }
}
```

---

### 1.3 Observation 阶段：反馈信息的筛选与利用

#### 策略 A：多层信息蒸馏

原始 Observation 往往包含大量冗余信息。通过多层蒸馏提取有效信号：

```
原始 Observation（可能 2000+ tokens）
        │
        ▼
┌─────────────────────┐
│  Layer-1: 结构化提取  │  → 提取关键数值、状态码、核心字段
├─────────────────────┤
│  Layer-2: 相关性过滤  │  → 仅保留与当前子任务相关的信息
├─────────────────────┤
│  Layer-3: 增量压缩    │  → 与历史 Observation 去重，仅保留增量
└─────────────────────┘
        │
        ▼
精炼 Observation（控制在 200-500 tokens）
```

**实现代码：**

```python
class ObservationDistiller:
    def __init__(self, max_tokens=500):
        self.max_tokens = max_tokens
        self.observation_history = []
    
    def distill(self, raw_observation, current_subtask, context):
        """多层蒸馏"""
        
        # Layer-1: 结构化提取
        structured = self.extract_structured(raw_observation)
        # 例：{"status": "success", "records_count": 42, 
        #       "key_metrics": {"avg_amount": 15000}, ...}
        
        # Layer-2: 相关性过滤
        relevant = self.filter_by_relevance(structured, current_subtask)
        # 仅保留与当前子任务相关的字段
        
        # Layer-3: 增量压缩
        incremental = self.compress_incremental(relevant, self.observation_history)
        # 与历史对比，仅传递新信息
        
        self.observation_history.append(incremental)
        
        return self.format_observation(incremental)
    
    def format_observation(self, distilled):
        """格式化输出，确保不超过 token 预算"""
        formatted = json.dumps(distilled, ensure_ascii=False, indent=2)
        if count_tokens(formatted) > self.max_tokens:
            # 进一步摘要
            formatted = self.summarize(distilled, self.max_tokens)
        return formatted
```

#### 策略 B：异常信号增强

当 Observation 中出现异常/错误时，增强其信号强度以引导 Agent 调整策略：

```python
OBSERVATION_ENHANCEMENT = {
    "error_patterns": {
        "timeout": {
            "enhancement": "⚠️ 工具调用超时。建议：1)减小查询范围 2)切换备用工具 3)拆分子查询",
            "auto_retry": True,
            "max_retries": 2,
            "backoff_strategy": "exponential"
        },
        "empty_result": {
            "enhancement": "🔍 查询返回空结果。建议：1)放宽筛选条件 2)检查查询参数 3)换用模糊搜索",
            "auto_retry": False,
            "suggest_alternatives": True
        },
        "permission_denied": {
            "enhancement": "🔒 权限不足。建议：1)使用当前权限可访问的替代工具 2)请求权限提升",
            "auto_retry": False,
            "escalation": True
        },
        "data_quality_issue": {
            "enhancement": "⚡ 数据质量问题。建议：1)使用数据清洗工具 2)标记问题字段 3)交叉验证",
            "auto_retry": False
        }
    }
}
```

#### 策略 C：Observation 记忆管理

```python
class ObservationMemory:
    """管理 Agent 在多轮 TAO 循环中的 Observation 记忆"""
    
    def __init__(self, max_context_tokens=4000):
        self.max_context_tokens = max_context_tokens
        self.short_term = []      # 最近 3 轮的完整 Observation
        self.working_memory = {}  # 关键事实的结构化存储
        self.long_term = []       # 压缩后的历史摘要
    
    def update(self, observation, round_num):
        # 短期记忆：保留最近 3 轮
        self.short_term.append({
            "round": round_num,
            "observation": observation
        })
        if len(self.short_term) > 3:
            evicted = self.short_term.pop(0)
            # 被驱逐的 Observation 提取关键事实后存入工作记忆
            self._extract_to_working_memory(evicted)
            # 进一步压缩存入长期记忆
            self._compress_to_long_term(evicted)
    
    def get_context(self):
        """为下一次 Thought 提供上下文"""
        return {
            "recent_observations": self.short_term,        # 近期详情
            "key_facts": self.working_memory,              # 全局关键事实
            "history_summary": self._summarize_long_term() # 历史摘要
        }
```

---

## 二、跨场景泛化能力优化

### 2.1 Prompt 模板的通用性设计

#### 设计原则：分层解耦架构

```
┌────────────────────────────────────────────────┐
│            System Prompt（通用层）               │
│  ─ ReAct 框架规则                               │
│  ─ 通用推理约束                                  │
│  ─ 安全护栏                                      │
├────────────────────────────────────────────────┤
│         Domain Adapter（领域适配层）              │
│  ─ 领域术语表                                    │
│  ─ 领域特定工具描述                               │
│  ─ 领域推理模式                                  │
├────────────────────────────────────────────────┤
│        Task Spec（任务规格层）                    │
│  ─ 具体任务描述                                  │
│  ─ 输入/输出格式                                 │
│  ─ Few-shot 示例                                │
├────────────────────────────────────────────────┤
│        Runtime Context（运行时上下文层）           │
│  ─ 用户画像                                      │
│  ─ 会话历史                                      │
│  ─ 环境信息                                      │
└────────────────────────────────────────────────┘
```

#### 通用 System Prompt 模板

```python
UNIVERSAL_SYSTEM_PROMPT = """
你是一个智能任务执行Agent。你通过 Thought-Action-Observation 循环来解决用户问题。

## 核心规则

### Thought（思考）
- 分析当前状态，明确还需要做什么
- 制定下一步计划并说明理由
- 评估已有信息的充分性
- 如果信息充足，准备给出最终答案

### Action（行动）
- 从可用工具中选择一个执行
- 必须提供工具所需的完整参数
- 每次只调用一个工具（除非明确支持并行调用）

### Observation（观察）
- 系统将返回工具执行结果
- 你需要基于结果决定下一步

## 通用约束
1. **目标导向**：每个Thought和Action都必须服务于解决用户问题
2. **最小行动原则**：优先选择最直接有效的方法
3. **失败恢复**：如果Action失败，分析原因并尝试替代方案（最多重试{max_retries}次）
4. **不确定性处理**：当信息不足以做出确定判断时，明确标注不确定性并说明原因
5. **终止条件**：当满足以下任一条件时输出最终答案：
   - 已获得回答问题所需的全部信息
   - 已穷尽所有可用工具和方法
   - 达到最大循环次数

## 输出格式
Thought: [你的思考过程]
Action: [工具名称]
Action Input: [工具参数，JSON格式]

或（当准备给出最终答案时）：
Thought: [总结思考]
Final Answer: [最终回答]

## 可用工具
{tool_descriptions}
"""
```

#### 领域适配器模板

```python
DOMAIN_ADAPTERS = {
    "financial_analysis": {
        "domain_context": "你是金融分析领域的专业Agent",
        "terminology": {
            "PE": "市盈率 (Price-to-Earnings Ratio)",
            "ROE": "净资产收益率 (Return on Equity)",
            "EBITDA": "息税折旧摊销前利润"
        },
        "reasoning_patterns": [
            "金融数据分析时，先确认数据时间范围和口径",
            "比率分析需要同时看绝对值和相对值",
            "趋势分析至少需要3个时间点的数据"
        ],
        "output_requirements": "数值结果保留2位小数，百分比保留1位小数"
    },
    
    "customer_service": {
        "domain_context": "你是客户服务领域的专业Agent",
        "terminology": {
            "SLA": "服务等级协议",
            "工单": "客户服务请求记录",
            "升级": "将问题转交给更高级别的支持人员"
        },
        "reasoning_patterns": [
            "先确认客户身份和历史交互记录",
            "区分紧急问题和非紧急问题",
            "解决方案需要考虑客户的技术水平"
        ],
        "output_requirements": "使用礼貌、专业的语言，避免技术术语"
    },
    
    "code_assistance": {
        "domain_context": "你是软件开发领域的专业Agent",
        "terminology": {
            "重构": "改善代码结构而不改变功能",
            "代码审查": "检查代码质量和潜在问题"
        },
        "reasoning_patterns": [
            "修改代码前先理解现有架构",
            "考虑变更的影响范围",
            "提供测试建议"
        ],
        "output_requirements": "代码需要包含注释，遵循项目现有风格"
    }
}
```

---

### 2.2 Few-shot 示例的选择策略

#### 策略 A：基于案例库的动态示例选择

```
┌──────────────────────────────────────────────────────┐
│                  Few-shot 示例选择引擎                 │
│                                                      │
│  ┌─────────────┐    ┌──────────────┐                │
│  │  案例库       │───▶│  相似度匹配   │                │
│  │  (向量数据库) │    │  (Embedding) │                │
│  └─────────────┘    └──────┬───────┘                │
│                            │                         │
│                     ┌──────▼───────┐                │
│                     │  多样性过滤   │  ← MMR算法      │
│                     └──────┬───────┘                │
│                            │                         │
│                     ┌──────▼───────┐                │
│                     │  难度适配     │  ← 匹配任务复杂度│
│                     └──────┬───────┘                │
│                            │                         │
│                     ┌──────▼───────┐                │
│                     │  示例排序     │  ← 由简到难排列  │
│                     └──────────────┘                │
└──────────────────────────────────────────────────────┘
```

#### 核心实现

```python
class DynamicFewShotSelector:
    def __init__(self, example_store, embedding_model):
        self.example_store = example_store  # 向量数据库
        self.embedding_model = embedding_model
        self.max_examples = 3
        self.max_tokens_budget = 1500
    
    def select_examples(self, user_query, task_complexity, domain):
        """动态选择最优 Few-shot 示例"""
        
        # Step 1: 语义检索候选示例
        query_embedding = self.embedding_model.embed(user_query)
        candidates = self.example_store.search(
            embedding=query_embedding,
            filter={"domain": domain},
            top_k=20
        )
        
        # Step 2: 多样性过滤（MMR - Maximal Marginal Relevance）
        diverse_candidates = self.mmr_select(
            candidates, 
            k=10, 
            lambda_param=0.7  # 0=最大多样性, 1=最大相关性
        )
        
        # Step 3: 难度适配
        matched = self.match_difficulty(
            diverse_candidates, 
            target_complexity=task_complexity
        )
        
        # Step 4: 确保覆盖关键模式
        covered_patterns = set()
        selected = []
        for example in matched:
            if example.pattern not in covered_patterns or len(selected) < 2:
                selected.append(example)
                covered_patterns.add(example.pattern)
            if len(selected) >= self.max_examples:
                break
        
        # Step 5: 按难度排序（由简到难，渐进式引导）
        selected.sort(key=lambda x: x.complexity)
        
        # Step 6: Token 预算控制
        return self.fit_token_budget(selected, self.max_tokens_budget)
    
    def mmr_select(self, candidates, k, lambda_param):
        """最大边际相关性算法，平衡相关性和多样性"""
        selected = [candidates[0]]
        remaining = candidates[1:]
        
        while len(selected) < k and remaining:
            best_score = -float('inf')
            best_candidate = None
            
            for candidate in remaining:
                # 与查询的相关性
                relevance = candidate.similarity_score
                # 与已选示例的最大相似度（多样性惩罚）
                max_sim = max(
                    self.cosine_similarity(candidate, s) 
                    for s in selected
                )
                # MMR 分数
                mmr_score = lambda_param * relevance - (1 - lambda_param) * max_sim
                
                if mmr_score > best_score:
                    best_score = mmr_score
                    best_candidate = candidate
            
            selected.append(best_candidate)
            remaining.remove(best_candidate)
        
        return selected
```

#### 示例库的结构化标注

```python
EXAMPLE_SCHEMA = {
    "id": "example_financial_003",
    "domain": "financial_analysis",
    "query": "分析过去3个季度公司A的营收趋势",
    "complexity": "tier_2",
    "pattern": "multi_step_data_analysis",  # 推理模式标签
    "tools_used": ["sql_executor", "chart_generator"],
    "reasoning_steps": 3,
    "demonstrates": [
        "时间序列数据查询",
        "多步骤工具串联",
        "趋势分析的推理模式"
    ],
    "trace": {
        "thought_1": "需要查询过去3个季度的营收数据...",
        "action_1": {"tool": "sql_executor", "input": "SELECT ..."},
        "observation_1": "返回3条记录...",
        "thought_2": "数据已获取，现在生成趋势图...",
        "action_2": {"tool": "chart_generator", "input": "..."},
        "observation_2": "图表生成成功",
        "final_answer": "过去3个季度营收分别为..."
    },
    "quality_score": 0.95,      # 人工评估的示例质量
    "success_rate": 0.88,       # 使用该示例后的任务成功率
    "avg_user_rating": 4.5      # 用户满意度
}
```

---

### 2.3 循环终止条件的自适应调整机制

#### 设计方案：多维度终止判定

```
┌─────────────────────────────────────────────────────────────┐
│                   自适应终止判定引擎                          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ 置信度评估   │  │ 收敛性检测   │  │ 资源消耗监控      │    │
│  │ (Confidence) │  │ (Convergence)│  │ (Resource Budget) │    │
│  └──────┬──────┘  └──────┬──────┘  └───────┬──────────┘    │
│         │                │                  │               │
│         └────────┬───────┴──────────────────┘               │
│                  │                                          │
│           ┌──────▼──────┐                                   │
│           │ 终止决策器   │                                   │
│           └──────┬──────┘                                   │
│                  │                                          │
│     ┌────────────┼────────────┬─────────────┐              │
│     ▼            ▼            ▼             ▼              │
│  ✅ 正常终止  ⚠️ 降级终止  🔄 继续循环  🆘 请求帮助         │
└─────────────────────────────────────────────────────────────┘
```

#### 核心实现

```python
class AdaptiveTerminationEngine:
    def __init__(self, config):
        self.max_rounds = config.get("max_rounds", 10)
        self.max_tokens = config.get("max_tokens", 8000)
        self.confidence_threshold = config.get("confidence_threshold", 0.8)
        self.stagnation_threshold = config.get("stagnation_threshold", 3)
        
        self.round_count = 0
        self.token_usage = 0
        self.confidence_history = []
        self.information_gain_history = []
    
    def should_terminate(self, current_state):
        """多维度终止判定"""
        
        self.round_count += 1
        self.token_usage += current_state.get("tokens_used", 0)
        
        # ═══════════════════════════════════════
        # 维度1: 置信度评估
        # ═══════════════════════════════════════
        confidence = self.assess_confidence(current_state)
        self.confidence_history.append(confidence)
        
        if confidence >= self.confidence_threshold:
            return TerminationDecision(
                action="TERMINATE",
                reason="confidence_sufficient",
                confidence=confidence,
                quality="high"
            )
        
        # ═══════════════════════════════════════
        # 维度2: 收敛性检测（信息增益递减）
        # ═══════════════════════════════════════
        info_gain = self.calculate_information_gain(current_state)
        self.information_gain_history.append(info_gain)
        
        if self._is_stagnating():
            if confidence >= self.confidence_threshold * 0.7:
                # 置信度接近阈值但增长停滞 → 降级终止
                return TerminationDecision(
                    action="TERMINATE_WITH_CAVEATS",
                    reason="stagnation_near_threshold",
                    confidence=confidence,
                    quality="medium",
                    caveats=self._identify_gaps(current_state)
                )
            else:
                # 置信度低且增长停滞 → 请求帮助
                return TerminationDecision(
                    action="ESCALATE",
                    reason="stagnation_low_confidence",
                    confidence=confidence,
                    quality="low"
                )
        
        # ═══════════════════════════════════════
        # 维度3: 资源消耗监控
        # ═══════════════════════════════════════
        if self.round_count >= self.max_rounds:
            return TerminationDecision(
                action="TERMINATE_WITH_CAVEATS",
                reason="max_rounds_reached",
                confidence=confidence,
                quality="medium" if confidence > 0.5 else "low"
            )
        
        if self.token_usage >= self.max_tokens:
            return TerminationDecision(
                action="TERMINATE_WITH_CAVEATS",
                reason="token_budget_exhausted",
                confidence=confidence,
                quality="medium" if confidence > 0.5 else "low"
            )
        
        # ═══════════════════════════════════════
        # 继续循环
        # ═══════════════════════════════════════
        return TerminationDecision(
            action="CONTINUE",
            reason="insufficient_evidence",
            confidence=confidence,
            suggested_next=self._suggest_next_action(current_state)
        )
    
    def assess_confidence(self, state):
        """评估当前回答的置信度"""
        factors = {
            "completeness": self._assess_completeness(state),    # 信息完整度
            "consistency": self._assess_consistency(state),      # 信息一致性
            "reliability": self._assess_reliability(state),      # 数据源可靠度
            "coverage": self._assess_coverage(state)             # 问题覆盖度
        }
        
        weights = {
            "completeness": 0.35,
            "consistency": 0.25,
            "reliability": 0.20,
            "coverage": 0.20
        }
        
        confidence = sum(
            factors[k] * weights[k] for k in factors
        )
        return confidence
    
    def _is_stagnating(self):
        """检测是否陷入停滞"""
        if len(self.information_gain_history) < self.stagnation_threshold:
            return False
        
        recent_gains = self.information_gain_history[-self.stagnation_threshold:]
        avg_gain = sum(recent_gains) / len(recent_gains)
        
        return avg_gain < 0.05  # 最近N轮平均信息增益低于5%
```

#### 动态参数调整（跨场景自适应）

```python
class DynamicParameterTuner:
    """根据场景特征自动调整终止参数"""
    
    SCENE_PROFILES = {
        "quick_qa": {
            # 简单问答场景：快速终止
            "max_rounds": 3,
            "confidence_threshold": 0.7,
            "stagnation_threshold": 2,
            "max_tokens": 3000
        },
        "complex_analysis": {
            # 复杂分析场景：允许更多轮次
            "max_rounds": 15,
            "confidence_threshold": 0.85,
            "stagnation_threshold": 4,
            "max_tokens": 12000
        },
        "creative_generation": {
            # 创意生成场景：基于质量标准而非信息完整度
            "max_rounds": 8,
            "confidence_threshold": 0.75,
            "stagnation_threshold": 3,
            "max_tokens": 8000,
            "quality_metrics": ["originality", "coherence", "relevance"]
        },
        "high_stakes_decision": {
            # 高风险决策场景：极高置信度要求
            "max_rounds": 20,
            "confidence_threshold": 0.95,
            "stagnation_threshold": 5,
            "max_tokens": 15000,
            "mandatory_verification": True,
            "dual_confirmation": True  # 需要两个独立来源确认
        }
    }
    
    def auto_configure(self, task_analysis):
        """根据任务分析结果自动选择配置"""
        scene = self.classify_scene(task_analysis)
        base_config = self.SCENE_PROFILES[scene]
        
        # 微调：根据具体任务特征调整
        if task_analysis.get("has_time_constraint"):
            base_config["max_rounds"] = min(base_config["max_rounds"], 5)
            base_config["max_tokens"] = min(base_config["max_tokens"], 5000)
        
        if task_analysis.get("requires_high_precision"):
            base_config["confidence_threshold"] = min(
                base_config["confidence_threshold"] + 0.1, 0.98
            )
        
        return base_config
```

---

## 三、完整实施架构

### 3.1 系统集成视图

```
┌─────────────────────────────────────────────────────────────────┐
│                      ReAct Agent 系统架构                        │
│                                                                 │
│  ┌──────────────┐                                               │
│  │  用户输入     │                                               │
│  └──────┬───────┘                                               │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────┐              │
│  │          任务分析与路由层                       │              │
│  │  • 复杂度评估 (Tier-1/2/3)                    │              │
│  │  • 场景分类 (Scene Profiling)                  │              │
│  │  • 参数自动配置 (Dynamic Tuning)               │              │
│  └──────┬───────────────────────────────────────┘              │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────┐              │
│  │          Prompt 组装层                         │              │
│  │  ┌────────────┐ ┌──────────┐ ┌────────────┐  │              │
│  │  │ System核心  │+│ 领域适配 │+│ Few-shot   │  │              │
│  │  └────────────┘ └──────────┘ └────────────┘  │              │
│  └──────┬───────────────────────────────────────┘              │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────┐              │
│  │       TAO 循环执行引擎                         │              │
│  │                                               │              │
│  │   ┌─────────┐    ┌─────────┐    ┌─────────┐  │              │
│  │   │ Thought │───▶│ Action  │───▶│Observat.│  │              │
│  │   │         │◀───│         │◀───│         │  │              │
│  │   └────┬────┘    └─────────┘    └─────────┘  │              │
│  │        │                                      │              │
│  │   ┌────▼────────────────────────────────┐    │              │
│  │   │      自适应终止判定引擎               │    │              │
│  │   │  • 置信度评估                        │    │              │
│  │   │  • 收敛性检测                        │    │              │
│  │   │  • 资源消耗监控                      │    │              │
│  │   └─────────────────────────────────────┘    │              │
│  └──────┬───────────────────────────────────────┘              │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────┐              │
│  │          输出与反馈层                          │              │
│  │  • 结果格式化                                 │              │
│  │  • 置信度标注                                 │              │
│  │  • 用户反馈收集 → 示例库更新                   │              │
│  └──────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 关键指标与监控

```python
MONITORING_METRICS = {
    # 效率指标
    "efficiency": {
        "avg_rounds_per_task": "平均TAO循环轮数",
        "avg_tokens_per_task": "平均token消耗",
        "avg_latency_per_task": "平均任务延迟",
        "tool_call_success_rate": "工具调用成功率"
    },
    
    # 质量指标
    "quality": {
        "task_completion_rate": "任务完成率",
        "answer_accuracy": "回答准确率（人工抽检）",
        "user_satisfaction": "用户满意度评分",
        "escalation_rate": "升级/转人工比例"
    },
    
    # 泛化指标
    "generalization": {
        "cross_domain_accuracy": "跨领域准确率",
        "new_task_success_rate": "新类型任务成功率",
        "few_shot_effectiveness": "Few-shot示例有效性",
        "prompt_robustness": "Prompt鲁棒性（对抗测试通过率）"
    },
    
    # 自适应指标
    "adaptation": {
        "termination_accuracy": "终止决策正确率",
        "false_positive_rate": "过早终止率",
        "false_negative_rate": "过晚终止率",
        "parameter_tuning_effectiveness": "参数调优有效性"
    }
}
```

### 3.3 持续优化闭环

```
生产环境运行
    │
    ▼
┌─────────────┐     ┌───────────────┐     ┌──────────────┐
│ 日志收集     │────▶│ 效果评估       │────▶│ 问题诊断     │
│ • TAO全链路  │     │ • 指标计算     │     │ • 失败案例   │
│ • 用户反馈   │     │ • 对比分析     │     │   根因分析   │
└─────────────┘     └───────────────┘     └──────┬───────┘
                                                  │
┌─────────────┐     ┌───────────────┐     ┌──────▼───────┐
│ A/B 测试    │◀────│ 策略更新       │◀────│ 优化方案设计  │
│ • 灰度发布   │     │ • 示例库扩充   │     │ • Prompt调优 │
│ • 效果对比   │     │ • 参数调整     │     │ • 策略迭代   │
└─────────────┘     └───────────────┘     └──────────────┘
```

---

## 四、总结：核心优化策略清单

| 优化维度 | 策略 | 预期收益 |
|---------|------|---------|
| **Thought 深度控制** | 分层推理框架 + 复杂度自动评估 | 减少 30-50% 的无效推理轮次 |
| **Action 工具选择** | 能力矩阵路由 + 动态编排 + 安全防护 | 工具选择准确率提升 20-40% |
| **Observation 利用** | 多层蒸馏 + 异常增强 + 记忆管理 | Token 消耗降低 40-60% |
| **Prompt 通用性** | 四层解耦架构 + 领域适配器模式 | 新场景接入时间从周级降至天级 |
| **Few-shot 选择** | 向量检索 + MMR多样性 + 难度适配 | 示例有效性提升 25-35% |
| **终止条件自适应** | 多维判定 + 场景参数自动配置 | 过早/过晚终止率降低 50%+ |

以上方案的核心思想是：**将 ReAct 从一个固定的推理循环，升级为一个可感知（任务复杂度）、可适配（场景特征）、可进化（反馈驱动）的智能执行框架。** 每一层优化都是可独立实施、逐步叠加的，建议从 Thought 深度控制和自适应终止条件开始，这两项的投入产出比最高。

---

## 五、优化优先级清单（基于 modu-agent 现状评估）

本清单基于对 `packages/modu-agent` 当前 LangGraph 多模式图结构（perception → memory_query → [agent⇄tools | planner→step_dispatch | supervisor→consensus] → finalize_response）的深度评估，按 **高 / 中 / 低** 三级排序。每项任务标注所触及的核心文件、依赖关系与执行建议。

### 5.1 高优先级（P0）— 最高投入产出比，建议首批实施

> 共同特征：直击当前 ReAct 循环三大核心短板（推理无分层、Observation 无蒸馏、终止仅靠 recursionLimit），且可通过"新增独立模块 + 节点注入"实现，对现有图拓扑无结构性破坏。

#### P0-1 ｜ Thought 分层推理框架（对应优化点 1）

- **触及文件**：新增 `src/reasoning/complexity-assessor.ts`；修改 `src/graph/state.ts`（新增 `complexity_assessment` / `reasoning_round_count` 字段）；修改 `src/graph/nodes.ts` 的 `makeAgentNode`（按 tier 调整 temperature）与 `routeAfterAgent`（按 `reasoning_budget` 强制终止）。
- **执行建议**：
  1. 先实现 `ComplexityAssessor` 为纯函数模块，含 LLM 评估 + 规则化回退（基于 query 长度与关键词），单元测试覆盖三类 tier 判定。
  2. 在 `perception` 节点之后、`routeAfterPerception` 之前插入复杂度评估调用，结果写入 state。
  3. `makeAgentNode` 内读取 tier 并映射 temperature（tier_1: 0.7 / tier_2: 0.5 / tier_3: 0.2），保留现有"低置信度保守温度"逻辑作为兜底。
  4. `routeAfterAgent` 增加 `reasoning_round_count >= reasoning_budget` 分支，置于 tool_calls 检查之前。
- **依赖**：无前置依赖，可独立实施。

#### P0-2 ｜ CoT 锚点 + 反思后缀（对应优化点 2）

- **触及文件**：仅修改 `src/graph/factory.ts` 的 `_DEFAULT_ANTI_HALLUCINATION_PROMPT` 拼接逻辑（追加锚点模板字符串）。
- **执行建议**：
  1. 锚点模板作为独立常量 `_COT_ANCHOR_TEMPLATE`，按 tier 条件拼接（tier_3 强制启用，tier_1 可选）。
  2. 反思后缀 `REFLECTION_SUFFIX` 作为独立常量，仅在 tier_2/3 启用。
  3. 通过 A/B 测试对比"启用锚点 vs 不启用"的 `avg_rounds_per_task` 与 `answer_accuracy`。
- **依赖**：建议在 P0-1 完成后实施，以复用 tier 判定结果。

#### P0-3 ｜ Observation 多层蒸馏器（对应优化点 3）

- **触及文件**：新增 `src/graph/adapters/observation-distiller.ts`；修改 `src/graph/nodes.ts` 的 `makeToolResultProcessor`（在 ToolMessage 写入前调用 distiller）；修改 `src/graph/state.ts`（新增 `observation_history` 字段）。
- **执行建议**：
  1. `ObservationDistiller` 实现三层管道（结构化提取 → 相关性过滤 → 增量压缩），默认 `maxTokens=500`，可配置。
  2. 在 `makeToolResultProcessor` 中以**包装器模式**接入：原始 parsedContent 保留为 `raw` 字段供调试，蒸馏结果作为 ToolMessage content。
  3. 增加 feature flag `enable_observation_distillation`（默认 true），异常时自动降级回原始 content，保证不阻断 ReAct 循环。
- **依赖**：无前置依赖。与 P0-1 并行实施。

#### P0-4 ｜ 自适应终止判定引擎（对应优化点 6）

- **触及文件**：新增 `src/graph/termination-engine.ts`；修改 `src/graph/nodes.ts` 的 `routeAfterAgent`（核心路由函数）；修改 `src/graph/state.ts`（新增 `confidence_history` / `information_gain_history` 字段）。
- **执行建议**：
  1. `AdaptiveTerminationEngine` 作为纯函数类，输入 state 输出 `TerminationDecision`，便于单元测试。
  2. **分阶段接入**：第一阶段仅在 `routeAfterAgent` 现有 tool_calls 检查之后追加 `shouldTerminate` 判定（不替换原逻辑），观察误判率；第二阶段待指标稳定后再调整为优先判定。
  3. `ESCALATE` 决策写入 state 的 `termination_reason` 字段，由 `finalize_response` 节点透传给用户。
- **依赖**：建议在 P0-1 完成后实施（置信度评估可复用 complexity_assessment 的 confidence_threshold）。

### 5.2 中优先级（P1）— 扩展与解耦，建议第二批实施

> 共同特征：在 P0 基础上扩展能力边界或解耦架构，部分触及工具选择与 Prompt 组装的核心路径，需更谨慎的兼容性设计。

#### P1-1 ｜ 异常信号增强（对应优化点 4）

- **触及文件**：扩展 `src/graph/adapters/observation-distiller.ts`；修改 `src/graph/nodes.ts` 的 `makeToolResultProcessor` 错误分支。
- **执行建议**：在 distiller 内增加 `ERROR_PATTERNS` 映射表，`toolResultProcessor` 检测 `status==='error'` 时匹配 error_code 并附加 enhancement 文本，不修改原始 error 结构。
- **依赖**：P0-3 完成后实施。

#### P1-2 ｜ Observation 三级记忆管理（对应优化点 5）

- **触及文件**：新增 `src/memory/observation-memory.ts`；修改 `src/graph/nodes.ts` 的 `agentNode`（读取 memory context 注入 SystemMessage）；修改 `src/graph/state.ts`（新增 `observation_memory` 字段）。
- **执行建议**：`ObservationMemory` 维护 short_term(3 轮) / working_memory / long_term(摘要)，在每轮 Observation 后调用 `update`，在 `agentNode` 入口调用 `getContext`。long_term 摘要复用 `reasoning/llm` 的 ModuLLM。
- **依赖**：P0-3 完成后实施。

#### P1-3 ｜ 场景化参数动态调优（对应优化点 7）

- **触及文件**：扩展 `src/graph/termination-engine.ts`；修改 `src/config/schemas.ts`（新增 `scene_profile` 配置项）。
- **执行建议**：定义 `SCENE_PROFILES` 字典（quick_qa / complex_analysis / creative_generation / high_stakes_decision），与 P0-1 的 tier 映射联动（tier_1→quick_qa，tier_2→complex_analysis，tier_3→high_stakes_decision）。配置项通过 LangGraph `runtime_config` 注入，避免硬编码。
- **依赖**：P0-1 与 P0-4 完成后实施。

#### P1-4 ｜ 四层 Prompt 解耦架构（对应优化点 8）

- **触及文件**：新增 `src/reasoning/prompt-composer.ts`、`src/reasoning/domain-adapters.ts`；修改 `src/graph/factory.ts` 的 `create_agent`（用 PromptComposer 替代直接拼接）。
- **执行建议**：
  1. 先将现有 `_DEFAULT_ANTI_HALLUCINATION_PROMPT` 拆解为 `UNIVERSAL_SYSTEM_PROMPT`（含 Thought/Action/Observation 角色规则）+ 安全护栏片段，**保证拼接结果与原 prompt 字符等价**（回归测试校验）。
  2. 再引入 `PromptComposer` 与 `DOMAIN_ADAPTERS`，默认 domain 为空时行为与现状完全一致。
  3. 领域适配器采用注册表模式，新领域接入仅需追加条目。
- **依赖**：可与 P0-2 并行实施（P0-2 的锚点模板作为 taskSpec 层注入）。

#### P1-5 ｜ 工具能力矩阵 + 意图路由（对应优化点 9）

- **触及文件**：新增 `src/tools/tool-registry.ts`；修改 `src/graph/nodes.ts` 的 `_filterToolsByTaskType`（升级为 intent 细粒度路由）。
- **执行建议**：
  1. `TOOL_CAPABILITY_MATRIX` 作为独立注册表，不替换现有 ComponentRegistry（职责不同：前者描述能力，后者管理生命周期）。
  2. `_filterToolsByTaskType` 改造为"先 task_type 粗筛 → 再 intent 细筛"两级管道，intent 匹配失败时回退到现有 task_type 逻辑。
- **依赖**：建议在 P1-4 完成后实施（intent 路由规则可作为 domainAdapter 的一部分）。

### 5.3 低优先级（P2）— 长期演进与高级能力

> 共同特征：要么依赖前序多项基础能力，要么触及图执行模型或安全关键路径，建议在 P0/P1 充分验证后实施。

#### P2-1 ｜ 写操作 + 敏感数据安全防护（对应优化点 10）

- **触及文件**：新增 `src/tools/tool-guardrails.ts`；修改 `src/graph/graph.ts`（在 ToolNode 前插入 guardrail 节点）；修改 `src/graph/nodes.ts` 的 HITL 审批逻辑。
- **执行建议**：guardrail 命中时通过 LangGraph `interrupt` 触发现有 HITL 机制，不新建独立审批流。`ACTION_GUARDRAILS` 配置化，支持按工具名/操作类型匹配。
- **依赖**：建议在 P1-5 完成后实施（依赖工具能力矩阵的 `requires_confirmation` 标注）。

#### P2-2 ｜ Few-shot 动态示例选择（对应优化点 11）

- **触及文件**：新增 `src/skills/few-shot-selector.ts`；修改 `src/graph/nodes.ts` 的 `agentNode`（调用 selector 注入 examples）；复用 `src/memory/chroma.ts`（新增 namespace）。
- **执行建议**：`DynamicFewShotSelector` 实现 MMR 算法（lambda=0.7），token 预算 1500。示例库初始为空时静默跳过，不影响现有流程。需配套建立示例标注规范（`EXAMPLE_SCHEMA`）。
- **依赖**：P1-4 完成后实施（examples 作为 taskSpec 层注入 PromptComposer）。

#### P2-3 ｜ 动态工具编排（串行/并行/条件分支）（对应优化点 12）

- **触及文件**：新增 `src/graph/adapters/tool-orchestrator.ts`；修改 `src/graph/graph.ts`（引入 LangGraph `Send` API 并行分发）；修改 `src/graph/nodes.ts` 的 agentNode 后续处理。
- **执行建议**：仅在 LLM 输出多个独立 tool_calls 时触发并行编排，依赖关系不明确时保守串行。复用 `plan-execute/dispatcher.ts` 的 `_identifyReadySteps` 依赖分析逻辑。
- **依赖**：P1-5 完成后实施。

---

## 六、风险登记表（逐项框架层影响专项评估）

### 6.1 评估框架说明

**"框架层核心业务逻辑"定义**：指 `modu-agent` 中以下任一层面的稳定契约，一旦修改可能波及多个节点或业务模式：

| 框架层 | 核心文件 | 稳定契约 |
|--------|---------|---------|
| 状态契约层 | `src/graph/state.ts` 的 `CoreState` | 所有节点读写依赖的字段定义 |
| 图拓扑层 | `src/graph/graph.ts`、`src/graph/factory.ts` | 节点注册、边连接、路由出口 |
| 路由决策层 | `src/graph/nodes.ts` 的 `routeAfterAgent` / `routeAfterPerception` / `routeAfterMemoryQuery` | ReAct 循环出口与模式切换 |
| 执行控制层 | `src/graph/runner.ts`（recursionLimit、stream 模式） | 图执行与递归控制 |
| 工具执行层 | `src/tools/synchronous-executor.ts`、`makeToolResultProcessor` | 工具调用与结果回写 |
| Plan-Execute 调度层 | `src/graph/plan-execute/dispatcher.ts` | DAG 步骤依赖与并行调度 |

**风险等级判定标准**：
- 🔴 **高**：直接修改路由决策层或图拓扑层，可能改变 ReAct 循环出口或模式切换行为，需回归测试全模式。
- 🟡 **中**：修改状态契约层或工具执行层核心路径，但通过包装器/feature flag 可降级，影响可隔离。
- 🟢 **低**：仅新增独立模块或修改 prompt 字符串，不触及上述任一稳定契约。

### 6.2 逐项风险登记表

#### 风险 R-01 ｜ P0-1 Thought 分层推理框架

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟡 中 — 修改 `state.ts`（CoreState 新增字段）+ `nodes.ts` 的 `routeAfterAgent`（新增终止分支） |
| 波及范围 | CoreState 新增字段需所有节点向后兼容（字段可选）；`routeAfterAgent` 新增分支影响 ReAct 循环出口判定 |
| 潜在副作用 | ① complexity_assessment 为空时（如 perception 未填充）导致 tier 默认值不符合预期；② `reasoning_round_count` 计数未在 tools 节点回写导致计数失真；③ tier 误判导致简单任务被强制多轮推理 |
| 规避/兼容策略 | ① 新增字段全部设为 `optional`，缺失时回退到 tier_2（等价现状行为）；② `reasoning_round_count` 在 `routeAfterAgent` 统一递增并 reducer 聚合，不依赖 tools 节点回写；③ `ComplexityAssessor` 失败时回退规则化评估，并记录 `assessment_fallback` 标记供监控；④ 上线前对 agent/plan-execute/supervisor 三模式全量回归测试 |

#### 风险 R-02 ｜ P0-2 CoT 锚点 + 反思后缀

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟢 低 — 仅修改 `factory.ts` 的 prompt 字符串拼接 |
| 波及范围 | 仅影响 LLM 输入 prompt，不改变图拓扑、路由、状态 |
| 潜在副作用 | ① 锚点模板增加 prompt 长度，可能挤压有效上下文；② LLM 未遵循锚点格式导致输出解析异常（若下游依赖结构化 Thought） |
| 规避/兼容策略 | ① 锚点模板控制在 300 tokens 以内，tier_1 默认关闭；② 下游不强制解析 Thought 结构（当前 function calling 模式下 LLM 直接输出 tool_calls，锚点仅起引导作用）；③ 通过 feature flag `enable_cot_anchor` 控制开关 |

#### 风险 R-03 ｜ P0-3 Observation 多层蒸馏器

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟡 中 — 修改 `nodes.ts` 的 `makeToolResultProcessor`（ReAct 循环 Observation 回写关键路径）+ `state.ts` 新增字段 |
| 波及范围 | ToolMessage content 被蒸馏替换，影响所有下游 LLM 调用对工具结果的感知；plan-execute 模式的 `step_dispatch` 也读取 tool_results |
| 潜在副作用 | ① 蒸馏过度丢失关键信息导致 LLM 误判；② 蒸馏器异常导致 ToolMessage 格式破坏，LLM 无法解析；③ 与 plan-execute 模式的 `tool_results` 状态字段格式不兼容 |
| 规避/兼容策略 | ① feature flag `enable_observation_distillation` 默认 true，异常自动降级回原始 content（try-catch 包裹）；② 原始 content 保留为 `ToolMessage.additional_kwargs.raw` 供调试与回退；③ 蒸馏器输出格式与现有 `parsedContent` 结构保持一致（status/records_count/key_metrics 字段对齐）；④ plan-execute 模式下蒸馏器读取 `current_step` 作为相关性过滤锚点，缺失时跳过 Layer-2 |

#### 风险 R-04 ｜ P0-4 自适应终止判定引擎

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🔴 高 — 直接修改 `nodes.ts` 的 `routeAfterAgent` 核心路由函数（ReAct 循环出口判定） |
| 波及范围 | `routeAfterAgent` 是 agent⇄tools 循环的唯一出口，误判将导致所有 ReAct 模式任务提前终止或无限循环；与 `runner.ts` 的 `recursionLimit` 协同 |
| 潜在副作用 | ① 置信度评估算法偏差导致过早终止（false positive），简单任务被截断；② 收敛性检测阈值过严导致过晚终止（false negative），消耗 recursion budget 直至 GraphRecursionError；③ `ESCALATE` 决策未在 `finalize_response` 处理导致状态泄露 |
| 规避/兼容策略 | ① **分阶段接入**：第一阶段 `shouldTerminate` 仅作为 advisory，结果写入 state 但不改变路由（仅采集指标）；第二阶段待 false_positive_rate < 5% 后才真正影响路由；② 保留现有 `tool_calls 存在 → 继续` 与 `recursionLimit` 作为双重兜底，`shouldTerminate` 仅在 tool_calls 为空时生效；③ `TerminationDecision` 含 `reason` 字段，`finalize_response` 透传为 `termination_reason`；④ `confidence_history` 与 `information_gain_history` 通过 reducer 聚合，避免并发覆盖；⑤ 上线前在 agent 模式做 100+ 用例回归 |

#### 风险 R-05 ｜ P1-1 异常信号增强

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟡 中 — 扩展 `makeToolResultProcessor` 错误分支 |
| 波及范围 | 仅影响 `status==='error'` 的 ToolMessage content |
| 潜在副作用 | ① error_code 匹配失败时无增强（可接受）；② enhancement 文本被下游误判为工具返回数据 |
| 规避/兼容策略 | ① enhancement 文本以 `⚠️` 前缀与明确分隔符标记，与原始 error payload 隔离；② 仅在 error 分支生效，success 分支不受影响 |

#### 风险 R-06 ｜ P1-2 Observation 三级记忆管理

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟡 中 — 修改 `state.ts` + `agentNode`（注入 SystemMessage） |
| 波及范围 | `observation_memory` 作为新 state 字段，需在 ReAct 循环每轮更新；agentNode 注入额外 context 增加 prompt 长度 |
| 潜在副作用 | ① long_term 摘要调用 LLM 增加延迟与 token 消耗；② memory 更新与 state reducer 冲突（并发覆盖）；③ 注入 context 过长挤压有效上下文 |
| 规避/兼容策略 | ① long_term 摘要采用异步/惰性生成（每 5 轮触发一次，不阻塞主循环）；② `ObservationMemory` 作为 state 中的不可变对象，通过 reducer 整体替换（非部分更新）；③ memory context 控制在 500 tokens 以内，超出时优先保留 working_memory |

#### 风险 R-07 ｜ P1-3 场景化参数动态调优

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟢 低 — 扩展 termination-engine（P0-4 子模块）+ config schema |
| 波及范围 | 仅影响 termination-engine 的参数取值，不改变路由逻辑 |
| 潜在副作用 | ① scene_profile 误匹配导致参数不符合任务特征；② 与 tier 映射冲突时优先级不明 |
| 规避/兼容策略 | ① scene_profile 支持运行时 override（通过 `runtime_config`）；② 显式定义优先级：`runtime_config.scene_profile` > `tier 映射` > `默认 complex_analysis`；③ 新增配置项均设默认值，缺失时等价现状 |

#### 风险 R-08 ｜ P1-4 四层 Prompt 解耦架构

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟡 中 — 修改 `factory.ts` 的 `create_agent`（图构建核心入口的 prompt 组装） |
| 波及范围 | `create_agent` 是所有模式（agent/plan-execute/supervisor）的图构建入口，prompt 拼接逻辑变更影响所有 LLM 调用 |
| 潜在副作用 | ① 拼接顺序变更导致 prompt 语义变化，LLM 行为漂移；② `DOMAIN_ADAPTERS` 未注册时返回 undefined 导致拼接异常；③ 与 `SkillPromptAggregator` 的现有聚合逻辑冲突 |
| 规避/兼容策略 | ① **字符等价回归**：第一阶段确保 `PromptComposer.compose({systemCore: 现有prompt})` 输出与现状完全一致（diff 校验）；② `DOMAIN_ADAPTERS` 查找失败时返回空字符串，不抛异常；③ `SkillPromptAggregator` 输出作为 taskSpec 层的子片段注入，不改变其内部聚合逻辑；④ domain 默认为空字符串，等价现状 |

#### 风险 R-09 ｜ P1-5 工具能力矩阵 + 意图路由

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟡 中 — 修改 `nodes.ts` 的 `_filterToolsByTaskType`（ReAct 循环工具暴露关键路径） |
| 波及范围 | 工具过滤结果直接影响 LLM 可选工具集，误过滤将导致 LLM 无法调用必要工具 |
| 潜在副作用 | ① intent 匹配失败导致工具集过窄；② `fallback_chain` 自动降级调用未授权工具；③ 与 plan-execute 模式的工具过滤逻辑不一致 |
| 规避/兼容策略 | ① 采用"先 task_type 粗筛 → 再 intent 细筛"两级管道，intent 匹配失败时回退到现有 task_type 结果（等价现状）；② `fallback_chain` 仅作为 prompt 中的建议文本，不自动执行，需 LLM 显式调用；③ plan-execute 模式复用同一 `TOOL_CAPABILITY_MATRIX`，通过 `planner` prompt 注入 selection_logic |

#### 风险 R-10 ｜ P2-1 写操作 + 敏感数据安全防护

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🔴 高 — 修改 `graph.ts`（图拓扑新增 guardrail 节点）+ `nodes.ts` 的 HITL 逻辑 |
| 波及范围 | 在 ToolNode 前插入新节点改变图执行流；HITL interrupt 时机变更影响所有写操作任务 |
| 潜在副作用 | ① guardrail 误判导致读操作被拦截，正常任务阻塞；② dry_run 结果未正确回写导致 LLM 误以为已执行；③ 与现有 `requiresApprovalFor` 重复触发导致双重审批 |
| 规避/兼容策略 | ① guardrail 仅对 `TOOL_CAPABILITY_MATRIX` 中 `requires_confirmation=true` 的工具生效，读操作默认放行；② dry_run 结果以独立 `dry_run_result` 字段回写，不污染 `tool_results`；③ 与 `requiresApprovalFor` 合并判定：guardrail 命中 → 直接 interrupt，未命中 → 走原有 `requiresApprovalFor` 逻辑；④ feature flag `enable_action_guardrails` 默认 false，灰度开启 |

#### 风险 R-11 ｜ P2-2 Few-shot 动态示例选择

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🟢 低 — 新增独立模块 + `agentNode` 注入 examples |
| 波及范围 | 仅影响 LLM 输入 prompt（examples 作为 taskSpec 子片段），不改变图拓扑与路由 |
| 潜在副作用 | ① 示例库为空时 selector 异常；② examples 过长挤压上下文；③ 示例质量差导致 LLM 模仿错误模式 |
| 规避/兼容策略 | ① 示例库为空时 selector 返回空数组，静默跳过；② token 预算硬上限 1500，超出时按 quality_score 截断；③ 示例入库前需人工审核 + quality_score 评分，低于 0.7 不入库；④ feature flag `enable_few_shot` 默认 false |

#### 风险 R-12 ｜ P2-3 动态工具编排

| 维度 | 评估 |
|------|------|
| 触及框架层 | 🔴 高 — 修改 `graph.ts`（引入 LangGraph `Send` API 并行分发）+ `nodes.ts` 的 agentNode 后续处理 |
| 波及范围 | 改变 ReAct 循环的执行模型（从串行 tool_calls 到并行 Send 分发），影响图执行的并发语义与 state reducer 聚合；与 `runner.ts` 的 stream 模式交互 |
| 潜在副作用 | ① 并行 tool 结果在 state reducer 中乱序合并导致 LLM 感知混乱；② 依赖关系误判导致并行执行本应串行的工具（数据竞争）；③ `Send` API 与现有 Checkpointer 的兼容性问题；④ 并行工具触发多次 HITL interrupt 导致用户体验混乱 |
| 规避/兼容策略 | ① **保守触发**：仅在 LLM 单次输出多个 tool_calls 且 `tool_orchestrator` 判定无依赖时才并行，其余情况保守串行（等价现状）；② 并行结果通过 reducer 按 `tool_call_id` 聚合，保留顺序元数据；③ 依赖分析复用 `plan-execute/dispatcher.ts` 的 `_identifyReadySteps` 已验证逻辑；④ 任一并行工具需 HITL 时，整组并行阻塞等待；⑤ feature flag `enable_parallel_tools` 默认 false，灰度验证后再开启；⑥ 上线前重点测试 Checkpointer 回放与 stream 输出顺序 |

### 6.3 风险汇总矩阵

| 风险 ID | 优化项 | 优先级 | 框架层风险 | 核心规避策略 |
|---------|--------|--------|-----------|-------------|
| R-01 | Thought 分层推理 | P0 | 🟡 中 | 字段全 optional + 规则化回退 + 三模式回归 |
| R-02 | CoT 锚点 | P0 | 🟢 低 | feature flag + token 预算控制 |
| R-03 | Observation 蒸馏 | P0 | 🟡 中 | feature flag + 异常降级 + 原始 content 保留 |
| R-04 | 自适应终止引擎 | P0 | 🔴 高 | 分阶段接入（先 advisory 后生效）+ 双重兜底 |
| R-05 | 异常信号增强 | P1 | 🟡 中 | 仅 error 分支生效 + 文本隔离标记 |
| R-06 | 三级记忆管理 | P1 | 🟡 中 | 异步摘要 + reducer 整体替换 + token 预算 |
| R-07 | 场景化参数 | P1 | 🟢 低 | 运行时 override + 显式优先级 |
| R-08 | 四层 Prompt 解耦 | P1 | 🟡 中 | 字符等价回归 + 空值兜底 |
| R-09 | 工具能力矩阵 | P1 | 🟡 中 | 两级管道 + intent 失败回退 |
| R-10 | 安全防护 | P2 | 🔴 高 | feature flag 默认 false + 与现有 HITL 合并判定 |
| R-11 | Few-shot 选择 | P2 | 🟢 低 | 空库静默跳过 + 质量门槛 + feature flag |
| R-12 | 动态工具编排 | P2 | 🔴 高 | 保守触发 + 依赖分析复用 + feature flag 默认 false |

### 6.4 跨项共性风险与全局规避策略

1. **CoreState 字段膨胀风险**（R-01/R-03/R-04/R-06 均新增 state 字段）
   - 规避：所有新增字段必须 `optional`，reducer 采用"存在则更新、缺失则保留"语义；定期清理未使用的 state 字段，避免 Checkpointer 持久化膨胀。

2. **feature flag 一致性风险**（多项依赖 flag 控制）
   - 规避：统一通过 `runtime_config` 注入 flag，在 `factory.ts` 的 `create_agent` 入口集中读取并下发，避免各节点分散读取导致不一致；建议建立 flag 注册表文档。

3. **三模式回归测试盲区**（agent / plan-execute / supervisor 三种业务模式）
   - 规避：任何触及 `nodes.ts` 路由函数或 `state.ts` 的改动，必须运行三模式回归测试集；建议建立最小回归用例集（每模式 20 case）作为 CI 门禁。

4. **LLM 行为漂移风险**（R-02/R-08/R-11 均改变 prompt 输入）
   - 规避：prompt 变更上线前必须通过"字符等价回归"或 A/B 测试，监控 `answer_accuracy` 与 `task_completion_rate` 是否在 ±2% 容差内。

5. **LangGraph 框架升级兼容性**（R-04/R-10/R-12 深度依赖 LangGraph 特性）
   - 规避：`Send` API、`interrupt`、`recursionLimit` 的使用需锁定 LangGraph 版本范围；关注 LangGraph 升级 changelog，重大变更前在独立分支验证。

### 6.5 实施顺序的风险控制建议

基于风险等级与依赖关系，推荐以下实施顺序以最小化累积风险：

```
第一批（P0，建立基础 + 风险可控）
  R-02 (CoT锚点, 🟢) → R-01 (分层推理, 🟡) → R-03 (Observation蒸馏, 🟡) → R-04 (自适应终止, 🔴, 分阶段)

  └─ 关键里程碑：R-04 第一阶段（advisory 模式）上线后观察 1 个迭代周期，
     确认 false_positive_rate < 5% 后再进入第二阶段（影响路由）。

第二批（P1，扩展解耦，依赖 P0 基础）
  R-05/R-06 (Observation增强, 🟡) → R-08 (Prompt解耦, 🟡, 字符等价回归) 
  → R-07 (场景化参数, 🟢) → R-09 (工具矩阵, 🟡)

  └─ 关键里程碑：R-08 完成字符等价回归后，prompt 维护成本显著降低，
     后续 P2 项可基于四层架构注入。

第三批（P2，高级能力，需充分验证）
  R-11 (Few-shot, 🟢) → R-10 (安全防护, 🔴, 灰度) → R-12 (动态编排, 🔴, 灰度)

  └─ 关键里程碑：R-10 与 R-12 均为 🔴 高风险，必须 feature flag 默认 false，
     灰度 5% → 25% → 100% 三阶段推进，每阶段观察至少 3 天。
```

**核心原则**：每一批内部并行实施，批次之间串行验证；任何 🔴 高风险项（R-04/R-10/R-12）禁止跳过灰度阶段直接全量；所有改动必须可通过 feature flag 一键回退至现状行为。