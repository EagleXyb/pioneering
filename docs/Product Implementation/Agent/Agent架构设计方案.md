# IAC Incubator Agent 架构设计方案

> 基于当前项目代码分析，设计感知 - 记忆 - 规划 - 决策 - 执行 - 反思六大能力的 Agent 架构

***

## 一、当前项目现状分析

### 1.1 现有架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          客户端层 (多端)                              │
│  frontend (React+Vite)  │  miniapp (Taro)  │  app (React Native)    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST API
┌──────────────────────────────▼──────────────────────────────────────┐
│                     Backend (NestJS + Prisma)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │  Profile     │ │  AIConfig    │ │ GlobalPrompt │                │
│  │  Module      │ │  Module      │ │  Module      │                │
│  └──────────────┘ └──────────────┘ └──────────────┘                │
│  ┌──────────────┐                                                   │
│  │ ChatConversation │  ← 当前唯一的"AI交互"模块                      │
│  │ Module          │    仅做：存消息 + 透传LLM                        │
│  └──────────────┘                                                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 直接 fetch
                    ┌──────────▼──────────┐
                    │  第三方 LLM API      │
                    │ (DeepSeek/GLM/...)  │
                    └─────────────────────┘
```

### 1.2 现有能力 vs Agent 所需能力

| Agent 能力            | 现有状态                                             | 差距分析                              |
| ------------------- | ------------------------------------------------ | --------------------------------- |
| **感知 (Perception)** | 有 `perception` Prompt 模块（仅编辑器占位），无实际逻辑           | 需要实现：用户意图识别、需求拆解、上下文理解            |
| **记忆 (Memory)**     | 仅有 `ChatConversation` + `ChatMessage` 表（会话级短期记忆） | 缺少：长期记忆、用户画像记忆、知识库记忆、会话摘要记忆       |
| **规划 (Planning)**   | 无                                                | 需要：任务拆解、步骤规划、方法论匹配                |
| **决策 (Decision)**   | 无                                                | 需要：基于规划选择下一步动作、工具选择               |
| **执行 (Execution)**  | 仅有透传 LLM 调用                                      | 需要：工具调用(Function Call)、多步骤执行、流式输出 |
| **反思 (Reflection)** | 有 `evaluation` Prompt 模块（仅编辑器占位），无实际逻辑           | 需要：结果评估、自我纠错、方案优化                 |

### 1.3 可直接复用的现有资产

| 资产                | 位置                                                                   | 复用方式                       |
| ----------------- | -------------------------------------------------------------------- | -------------------------- |
| Prompt 四模块体系      | `frontend/pages/admin/{perception,retrieval,generation,evaluation}/` | 直接映射为 Agent 的 4 个阶段 Prompt |
| GlobalPrompt 版本管理 | `backend/src/modules/global-prompt/`                                 | Agent 各阶段 Prompt 的版本控制     |
| 多 LLM Provider 支持 | `backend/src/modules/ai-config/ai-config.service.ts`                 | Agent 执行层的模型调用             |
| 流式响应 + 思考链解析      | `frontend/pages/trial-center/useStreamChat.ts`                       | Agent 执行过程的前端展示            |
| 会话消息持久化           | `backend/src/modules/chat-conversation/`                             | Agent 短期记忆存储               |

***

## 二、Agent 架构总体设计

### 2.1 核心架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         🧠 IAC Agent Core                                │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Agent Orchestrator (编排器)                    │  │
│  │  控制 Agent 主循环: while(not_done) { perceive → plan → decide    │  │
│  │                    → execute → reflect → loop }                   │  │
│  └──────────────────────────────┬───────────────────────────────────┘  │
│                                 │                                       │
│     ┌───────────┬───────────┬───┴─────┬───────────┬───────────┐        │
│     ▼           ▼           ▼         ▼           ▼           ▼        │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐         │
│  │ 感知 │  │ 记忆 │  │ 规划 │  │ 决策 │  │ 执行 │  │ 反思 │         │
│  │Module│  │Module│  │Module│  │Module│  │Module│  │Module│         │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘         │
│     │         │         │         │         │         │               │
└─────┼─────────┼─────────┼─────────┼─────────┼─────────┼───────────────┘
      │         │         │         │         │         │
┌─────▼─────┐ ┌─▼───────┐ ┌▼──────┐ ┌▼──────┐ ┌▼──────┐ ┌▼──────┐
│ Prompt    │ │ Memory  │ │Method │ │Tool   │ │LLM    │ │Eval   │
│ Registry  │ │ Store   │ │Library│ │Registry│ │Gateway│ │Engine │
│(4模块复用)│ │(PG+向量)│ │(知识库)│ │(工具集)│ │(多模型)│ │(评分) │
└───────────┘ └─────────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

### 2.2 Agent 主循环 (ReAct 模式)

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent 主循环流程                            │
│                                                               │
│  用户输入                                                      │
│     │                                                         │
│     ▼                                                         │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐                │
│  │ 1. 感知 │────▶│ 2. 记忆 │────▶│ 3. 规划 │                │
│  │ 意图识别│     │ 上下文  │     │ 任务拆解│                │
│  │ 需求锚定│     │ 检索    │     │ 方法匹配│                │
│  └─────────┘     └─────────┘     └────┬────┘                │
│                                       │                      │
│                    ┌──────────────────▼──────────────┐      │
│                    │       4. 决策 + 5. 执行          │      │
│                    │   ┌──────────────────────┐      │      │
│                    │   │  for each step:      │      │      │
│                    │   │    decide(action)    │      │      │
│                    │   │    → LLM / Tool      │      │      │
│                    │   │    execute(action)   │      │      │
│                    │   │    observe(result)   │      │      │
│                    │   └──────────────────────┘      │      │
│                    └──────────────┬──────────────────┘      │
│                                   │                          │
│                          ┌────────▼────────┐                │
│                          │   6. 反思        │                │
│                          │   结果评估        │                │
│                          │   是否需要重试    │                │
│                          └────────┬────────┘                │
│                                   │                          │
│                          ┌────────▼────────┐                │
│                          │  完成 / 继续循环  │                │
│                          └─────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

***

## 三、六大能力模块详细设计

### 3.1 感知模块 (Perception Module)

**职责**：理解用户输入，识别意图，锚定需求

**复用现有**：`frontend/pages/admin/perception/` 的 Prompt 配置

**新增实现**：

```
backend/src/modules/agent/
├── perception/
│   ├── perception.service.ts    ← 核心：调用 perception Prompt + LLM
│   ├── perception.module.ts
│   └── dto/
│       └── perception.dto.ts
```

**核心逻辑**：

1. 加载 `perception` 模块的 Prompt 模板
2. 将用户输入 + 会话上下文注入 Prompt
3. 调用 LLM 进行意图识别和需求拆解
4. 输出结构化结果：`{ intent, domain, key_requirements, constraints }`

**输入 → 输出示例**：

```
输入: "我想做一个针对年轻人的社交产品"
输出: {
  intent: "creative_incubation",
  domain: "社交产品",
  target_users: "年轻人",
  key_requirements: ["社交功能", "年轻化设计", "差异化定位"],
  constraints: [],
  clarity_score: 0.6  // 需求清晰度，<0.7 触发追问
}
```

***

### 3.2 记忆模块 (Memory Module)

**职责**：多层级记忆管理，上下文检索

**复用现有**：`ChatConversation` + `ChatMessage` 表（短期记忆）

**新增数据库表**：

```prisma
// === 长期记忆 ===
model AgentMemory {
  id          Int      @id @default(autoincrement())
  sessionId   String                        // 会话ID
  memoryType  String                        // short_term | long_term | user_profile | knowledge
  category    String?                       // 记忆分类：user_need, creative_idea, preference
  content     String                        // 记忆内容（JSON或文本）
  importance  Float    @default(0.5)        // 重要性评分 0-1
  accessCount Int      @default(0)          // 访问次数
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([sessionId])
  @@index([memoryType, category])
  @@map("agent_memory")
}

// === 用户画像记忆 ===
model UserProfileMemory {
  id          Int      @id @default(autoincrement())
  userId      String
  profileKey  String                        // 记忆键：preferred_method, industry, role
  profileValue String                       // 记忆值
  confidence  Float    @default(0.5)        // 置信度
  source      String                        // 来源：explicit(用户明确) | inferred(推理)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, profileKey])
  @@map("user_profile_memory")
}

// === 会话摘要记忆 ===
model SessionSummary {
  id          Int      @id @default(autoincrement())
  sessionId   String   @unique
  summary     String                        // 会话摘要
  keyPoints   String[]                      // 关键要点
  outcome     String?                       // 会话成果
  createdAt   DateTime @default(now())

  @@map("session_summary")
}
```

**记忆层级**：

| 层级       | 存储                               | 生命周期 | 内容               |
| -------- | -------------------------------- | ---- | ---------------- |
| **工作记忆** | `ChatMessage` 表（已有）              | 当前会话 | 最近 N 轮对话         |
| **短期记忆** | `AgentMemory` (type=short\_term) | 当前会话 | 需求锚定结果、创意清单、中间产物 |
| **长期记忆** | `AgentMemory` (type=long\_term)  | 跨会话  | 重要决策、用户偏好、历史方案   |
| **用户画像** | `UserProfileMemory`              | 永久   | 行业、角色、偏好方法论、风格   |
| **会话摘要** | `SessionSummary`                 | 永久   | 每次会话的结构化摘要       |

**记忆检索流程**：

```
当前输入 → 计算 embedding(可选)
  → 1. 查短期记忆(同session)
  → 2. 查用户画像(userId)
  → 3. 查长期记忆(相似内容)
  → 4. 查历史会话摘要
  → 组装上下文注入 Prompt
```

***

### 3.3 规划模块 (Planning Module)

**职责**：任务拆解、步骤规划、方法论匹配

**复用现有**：`frontend/pages/admin/retrieval/` 的 Prompt 配置（知识检索 → 方法论匹配）

**新增数据库表**：

```prisma
// === 方法论知识库 ===
model Methodology {
  id          Int      @id @default(autoincrement())
  name        String   @unique               // 方法论名称：5W2H, SCAMPER, TRIZ
  category    String                         // 分类：demand_analysis | creative_divergence | evaluation
  description String                         // 描述
  steps       Json                           // 步骤定义 [{order, name, prompt, expected_output}]
  applicableScenarios String[]               // 适用场景标签
  examples    Json?                          // 案例
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("methodology")
}

// === Agent 任务计划 ===
model AgentPlan {
  id          Int      @id @default(autoincrement())
  sessionId   String
  planName    String                         // 计划名称
  steps       Json                           // [{stepId, name, methodology, status, result}]
  status      String   @default("in_progress") // in_progress | completed | failed
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([sessionId])
  @@map("agent_plan")
}
```

**规划流程**：

```
感知结果(需求锚定)
  → 匹配方法论(Methodology表)
  → 生成执行计划(AgentPlan)
  → 计划包含步骤序列：
     [
       { step: 1, name: "需求拆解", method: "5W2H", prompt_id: "xxx" },
       { step: 2, name: "案例激活", method: "case_match", prompt_id: "xxx" },
       { step: 3, name: "创意发散", method: "SCAMPER", prompt_id: "xxx" },
       { step: 4, name: "方案评估", method: "six_hats", prompt_id: "xxx" },
     ]
```

***

### 3.4 决策模块 (Decision Module)

**职责**：根据当前状态决定下一步动作（调用 LLM / 调用工具 / 追问用户 / 完成任务）

**决策状态机**：

```
                    ┌──────────────┐
                    │   观察状态    │
                    │ (当前步骤+    │
                    │  历史结果)    │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │      决策引擎            │
              │  (基于规则 + LLM判断)    │
              └──┬──────┬──────┬──────┬─┘
                 │      │      │      │
        ┌────────▼─┐ ┌──▼───┐ ┌▼────┐ ┌▼────┐
        │ call_llm │ │call_ │ │ask_ │ │done │
        │ (调用模型)│ │tool  │ │user │ │(完成)│
        └──────────┘ └──────┘ └─────┘ └─────┘
```

**决策规则**：

1. 需求清晰度 < 0.7 → `ask_user`（追问补充信息）
2. 当前步骤需要 LLM 推理 → `call_llm`
3. 需要外部数据/操作 → `call_tool`
4. 所有步骤完成 → `done`

***

### 3.5 执行模块 (Execution Module)

**职责**：实际执行 LLM 调用或工具调用，流式返回结果

**复用现有**：

- `ai-config.service.ts` 的多 Provider LLM 调用
- `useStreamChat.ts` 的流式响应 + 思考链解析

**新增：工具注册与调用**

```prisma
// === 工具注册表 ===
model AgentTool {
  id          Int      @id @default(autoincrement())
  name        String   @unique               // 工具名：web_search, mind_map, export_doc
  description String                         // 工具描述
  category    String                         // 分类：search | create | export | analyze
  endpoint    String?                        // API端点（内部工具）
  schema      Json                           // Function Call JSON Schema
  status      String   @default("active")
  createdAt   DateTime @default(now())

  @@map("agent_tool")
}
```

**MVP 阶段工具集**：

| 工具                | 功能        | 优先级 |
| ----------------- | --------- | --- |
| `save_creative`   | 保存创意到创意清单 | P0  |
| `search_case`     | 搜索跨领域案例   | P0  |
| `get_methodology` | 获取方法论详情   | P0  |
| `evaluate_idea`   | 评估单个创意    | P1  |
| `export_plan`     | 导出方案文档    | P1  |
| `web_search`      | 联网搜索      | P2  |

**执行流程**：

```
决策 → "call_llm"
  → 1. 加载对应步骤的 Prompt 模板
  → 2. 注入记忆上下文
  → 3. 调用 LLM (流式)
  → 4. 解析思考链 + 回答
  → 5. 保存结果到 AgentMemory
  → 6. 返回观察结果给决策模块

决策 → "call_tool"
  → 1. 匹配工具 Schema
  → 2. 执行工具调用
  → 3. 保存结果
  → 4. 返回观察结果
```

***

### 3.6 反思模块 (Reflection Module)

**职责**：评估执行结果，判断是否需要重试或优化

**复用现有**：`frontend/pages/admin/evaluation/` 的 Prompt 配置

**反思检查清单**：

| 检查项   | 触发条件           | 动作       |
| ----- | -------------- | -------- |
| 结果质量  | LLM 返回内容过短/不完整 | 重试当前步骤   |
| 格式合规  | 输出不符合预期格式      | 格式修正     |
| 逻辑一致性 | 前后步骤结果矛盾       | 回溯修正     |
| 用户满意度 | 用户反馈不满意        | 重新规划     |
| 循环次数  | 同一步骤重试 > 3 次   | 降级处理/转人工 |

**反思输出**：

```json
{
  "step_id": "step_3",
  "quality_score": 0.85,
  "issues": ["创意数量不足"],
  "action": "retry_with_hint",
  "hint": "请从更多维度发散创意，至少生成5个"
}
```

***

## 四、数据库 Schema 变更汇总

在现有 `schema.prisma` 基础上新增以下模型：

```prisma
// ===== 新增模型 =====

model AgentMemory {
  id          Int      @id @default(autoincrement())
  sessionId   String
  memoryType  String   // short_term | long_term | user_profile | knowledge
  category    String?
  content     String
  importance  Float    @default(0.5)
  accessCount Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([sessionId])
  @@index([memoryType, category])
  @@map("agent_memory")
}

model UserProfileMemory {
  id           Int      @id @default(autoincrement())
  userId       String
  profileKey   String
  profileValue String
  confidence   Float    @default(0.5)
  source       String   // explicit | inferred
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([userId, profileKey])
  @@map("user_profile_memory")
}

model SessionSummary {
  id        Int      @id @default(autoincrement())
  sessionId String   @unique
  summary   String
  keyPoints String[]
  outcome   String?
  createdAt DateTime @default(now())

  @@map("session_summary")
}

model Methodology {
  id                  Int      @id @default(autoincrement())
  name                String   @unique
  category            String
  description         String
  steps               Json
  applicableScenarios String[]
  examples            Json?
  status              String   @default("active")
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@map("methodology")
}

model AgentPlan {
  id        Int      @id @default(autoincrement())
  sessionId String
  planName  String
  steps     Json
  status    String   @default("in_progress")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sessionId])
  @@map("agent_plan")
}

model AgentTool {
  id          Int      @id @default(autoincrement())
  name        String   @unique
  description String
  category    String
  endpoint    String?
  schema      Json
  status      String   @default("active")
  createdAt   DateTime @default(now())

  @@map("agent_tool")
}
```

***

## 五、后端新增模块结构

```
backend/src/modules/agent/
├── agent.module.ts                    # Agent 总模块（聚合所有子模块）
├── agent.controller.ts                # Agent API 入口
├── agent.service.ts                   # Agent 主循环编排器
│
├── orchestrator/
│   ├── orchestrator.service.ts        # 主循环控制：while(not_done) { ... }
│   └── orchestrator.module.ts
│
├── perception/
│   ├── perception.service.ts          # 意图识别 + 需求锚定
│   ├── perception.module.ts
│   └── dto/perception.dto.ts
│
├── memory/
│   ├── memory.service.ts              # 多层级记忆 CRUD + 检索
│   ├── memory.module.ts
│   └── dto/memory.dto.ts
│
├── planning/
│   ├── planning.service.ts            # 任务拆解 + 方法论匹配
│   ├── planning.module.ts
│   └── dto/planning.dto.ts
│
├── decision/
│   ├── decision.service.ts            # 状态机决策
│   ├── decision.module.ts
│   └── dto/decision.dto.ts
│
├── execution/
│   ├── execution.service.ts           # LLM 调用 + 工具调用
│   ├── execution.module.ts
│   ├── tools/
│   │   ├── tool-registry.service.ts   # 工具注册与发现
│   │   ├── save-creative.tool.ts      # 保存创意工具
│   │   ├── search-case.tool.ts        # 搜索案例工具
│   │   └── get-methodology.tool.ts    # 获取方法论工具
│   └── dto/execution.dto.ts
│
├── reflection/
│   ├── reflection.service.ts          # 结果评估 + 纠错
│   ├── reflection.module.ts
│   └── dto/reflection.dto.ts
│
└── knowledge/
    ├── knowledge.service.ts           # 方法论 + 案例库管理
    ├── knowledge.module.ts
    └── dto/knowledge.dto.ts
```

***

## 六、API 接口设计

### 6.1 Agent 核心接口

| 方法     | 路径                             | 说明                  |
| ------ | ------------------------------ | ------------------- |
| `POST` | `/api/agent/run`               | 启动 Agent 执行（非流式）    |
| `POST` | `/api/agent/run/stream`        | 启动 Agent 执行（SSE 流式） |
| `POST` | `/api/agent/stop`              | 停止 Agent 执行         |
| `GET`  | `/api/agent/status/:sessionId` | 查询 Agent 执行状态       |

### 6.2 请求/响应格式

**请求**：

```json
POST /api/agent/run/stream
{
  "sessionId": "uuid",
  "userId": "user_123",
  "input": "我想做一个针对年轻人的社交产品",
  "mode": "incubation",
  "config": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  }
}
```

**SSE 流式响应**：

```
data: {"type":"agent_status","phase":"perception","message":"正在理解您的需求..."}
data: {"type":"agent_status","phase":"planning","message":"正在匹配合适的创新方法..."}
data: {"type":"agent_think","phase":"execution","step":1,"content":"首先用5W2H拆解..."}
data: {"type":"agent_output","phase":"execution","step":1,"content":"### 需求锚定报告\n..."}
data: {"type":"agent_status","phase":"reflection","message":"正在评估结果质量..."}
data: {"type":"agent_done","summary":"..."}
```

***

## 七、前端改造要点

### 7.1 现有 TrialCenter 改造

当前 [TrialCenter.tsx](file:///c:/Users/hs202/Desktop/IAC-incubator/frontend/pages/trial-center/TrialCenter.tsx) 是简单的 Chat UI，需要升级为 Agent 交互界面：

1. **新增 Agent 状态指示器**：显示当前阶段（感知中 → 规划中 → 执行中 → 反思中）
2. **新增步骤进度条**：显示当前执行到第几步/共几步
3. **新增中间产物展示区**：需求锚定报告、创意清单等结构化卡片
4. **复用思考链动画**：已有 `<think>` 标签解析，展示 Agent 思考过程

### 7.2 小程序 IAC 页面改造

当前 [miniapp/src/pages/iac/](file:///c:/Users/hs202/Desktop/IAC-incubator/miniapp/src/pages/iac/) 也是简单 Chat，同样需要升级。

***

## 八、实施路径规划

### MVP 阶段（核心闭环）- 预计 2-3 周

```
目标：跑通 "感知 → 规划 → 执行 → 反思" 最小闭环
```

| 优先级    | 任务                               | 说明                                       |
| ------ | -------------------------------- | ---------------------------------------- |
| **P0** | 创建 `agent` 模块骨架                  | `agent.module.ts` + `orchestrator`       |
| **P0** | 实现 `perception.service`          | 复用现有 perception Prompt，实现意图识别            |
| **P0** | 实现 `planning.service`            | 硬编码 5W2H + SCAMPER 方法论，实现步骤规划            |
| **P0** | 实现 `execution.service`           | 复用 `ai-config.service` 的 LLM 调用，流式输出     |
| **P0** | 实现 `orchestrator.service`        | Agent 主循环，串联各模块                          |
| **P0** | 实现 `memory.service` (短期)         | 复用 `ChatMessage` 表，新增 `AgentMemory` 短期记忆 |
| **P0** | 新增 `AgentMemory` + `AgentPlan` 表 | Prisma migrate                           |
| **P0** | 前端 Agent 交互 UI                   | 改造 TrialCenter，新增状态指示器                   |

### 迭代 1（记忆增强）- 预计 1-2 周

| 优先级    | 任务                                          | 说明             |
| ------ | ------------------------------------------- | -------------- |
| **P1** | 实现 `memory.service` (长期)                    | 跨会话记忆、用户画像记忆   |
| **P1** | 实现 `reflection.service`                     | 结果评估 + 自动纠错    |
| **P1** | 新增 `UserProfileMemory` + `SessionSummary` 表 | Prisma migrate |
| **P1** | 实现 `decision.service`                       | 完整状态机决策        |

### 迭代 2（知识库 + 工具）- 预计 2 周

| 优先级    | 任务                               | 说明                                |
| ------ | -------------------------------- | --------------------------------- |
| **P2** | 实现 `knowledge.service`           | 方法论知识库 CRUD + 检索                  |
| **P2** | 实现工具注册与调用                        | `tool-registry.service` + MVP 工具集 |
| **P2** | 新增 `Methodology` + `AgentTool` 表 | Prisma migrate                    |
| **P2** | 案例库管理                            | 跨领域案例的结构化存储与检索                    |

### 迭代 3（架构升级）- 预计 2-3 周

| 优先级    | 任务                | 说明                     |
| ------ | ----------------- | ---------------------- |
| **P3** | 引入向量检索 (PGVector) | 知识库语义检索                |
| **P3** | 多 Agent 协作        | 评估 Agent + 生成 Agent 分工 |
| **P3** | 方案结构化输出           | Word/PDF 导出            |
| **P3** | 多模态支持             | 图片上传分析                 |

***

## 九、关键技术决策建议

| 决策点       | 建议                                | 理由                                  |
| --------- | --------------------------------- | ----------------------------------- |
| Agent 框架  | **手写 ReAct**，不引入 LangChain        | 项目已有 NestJS 体系，LangChain 引入过重，手写更可控 |
| 记忆存储      | **PostgreSQL JSON 字段**，MVP 不引入向量库 | 符合文档规划，MVP 记忆需求简单                   |
| 工具调用      | **LLM Function Call 原生支持**        | DeepSeek/GLM 均支持 Function Call      |
| 流式输出      | **SSE (Server-Sent Events)**      | 已有 `useStreamChat.ts` 基础，扩展即可       |
| Prompt 管理 | **复用现有 GlobalPrompt 版本体系**        | 已有完整的版本/审批/上线流程                     |

***

## 十、风险与注意事项

1. **LLM 调用成本**：Agent 循环中每次步骤都可能调用 LLM，需控制 max\_steps 上限（建议 ≤ 10）
2. **超时处理**：已有 `REQUEST_TIMEOUT` 机制，Agent 循环需额外加全局超时（建议 120s）
3. **循环死锁**：同一步骤重试 > 3 次自动降级，避免无限循环
4. **上下文窗口**：多轮记忆注入需控制 Token 预算，超限时自动摘要压缩
5. **向后兼容**：现有 Chat 模式保持不变，Agent 模式作为新入口 `/api/agent/run`

