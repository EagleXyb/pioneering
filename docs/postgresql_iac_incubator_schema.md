# PostgreSQL 数据库表结构文档

> **数据库:** iac_incubator  
> **Schema:** public  
> **导出时间:** 2025-01-20  
> **表数量:** 9 张

---

## 目录

- [1. agent_log（代理日志）](#1-agent_log代理日志)
- [2. AIConfig（AI配置）](#2-aiconfigai配置)
- [3. creative_list（创意列表）](#3-creative_list创意列表)
- [4. demand_anchor（需求锚点）](#4-demand_anchor需求锚点)
- [5. global_prompt（全局提示词模板）](#5-global_prompt全局提示词模板)
- [6. innovation_case（创新案例）](#6-innovation_case创新案例)
- [7. innovation_method（创新方法）](#7-innovation_method创新方法)
- [8. Profile（用户资料）](#8-profile用户资料)
- [9. user_session（用户会话）](#9-user_session用户会话)
- [表关系图](#表关系图)
- [索引汇总](#索引汇总)

---

## 1. agent_log（代理日志）

**说明:** 存储 AI Agent 的执行日志

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| session_id | varchar(64) | NOT NULL | - | 会话ID |
| log_type | varchar(32) | NOT NULL | - | 日志类型 |
| input | text | - | - | 输入内容 |
| output | text | - | - | 输出内容 |
| cost_time | int4 | - | - | 耗时(毫秒) |
| create_time | timestamp(6) | - | CURRENT_TIMESTAMP | 创建时间 |

**主键:** `id`

**索引:** 无

**外键:** 无

---

## 2. AIConfig（AI配置）

**说明:** 存储 AI 模型的配置信息

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| apiKey | text | NOT NULL | - | API密钥 |
| provider | text | NOT NULL | - | AI提供商 |
| model | text | NOT NULL | - | 模型名称 |
| prompt | text | NOT NULL | - | 系统提示词 |
| lastTestInput | text | - | - | 最近测试输入 |
| lastTestResult | text | - | - | 最近测试结果 |
| lastTestTime | timestamp(3) | - | - | 最近测试时间 |
| createdAt | timestamp(3) | NOT NULL | CURRENT_TIMESTAMP | 创建时间 |
| updatedAt | timestamp(3) | NOT NULL | - | 更新时间 |

**主键:** `id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| AIConfig_provider_model_key | UNIQUE | provider, model |

**外键:** 无

---

## 3. creative_list（创意列表）

**说明:** 存储用户会话中生成的创意列表

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| session_id | varchar(64) | NOT NULL | - | 会话ID |
| content | text | NOT NULL | - | 创意内容 |
| sort | int4 | - | 1 | 排序序号 |
| create_time | timestamp(6) | - | CURRENT_TIMESTAMP | 创建时间 |

**主键:** `id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| idx_creative_session | INDEX | session_id |

**外键:**
| 约束名 | 字段 | 引用表 | 引用字段 | 级联删除 |
|--------|------|--------|----------|----------|
| creative_list_session_id_fkey | session_id | user_session | session_id | CASCADE |

---

## 4. demand_anchor（需求锚点）

**说明:** 存储用户需求的锚定信息

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| session_id | varchar(64) | NOT NULL | - | 会话ID |
| target | text | NOT NULL | - | 目标 |
| user_group | text | NOT NULL | - | 用户群体 |
| constraint_condition | text | NOT NULL | - | 约束条件 |
| innovation_type | varchar(32) | NOT NULL | - | 创新类型 |

**主键:** `id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| demand_anchor_session_id_key | UNIQUE | session_id |

**外键:**
| 约束名 | 字段 | 引用表 | 引用字段 | 级联删除 |
|--------|------|--------|----------|----------|
| demand_anchor_session_id_fkey | session_id | user_session | session_id | CASCADE |

---

## 5. global_prompt（全局提示词模板）

**说明:** 存储全局可复用的提示词模板

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| name | text | NOT NULL | - | 模板名称 |
| templateContent | text | NOT NULL | - | 模板内容 |
| version | int4 | NOT NULL | 1 | 版本号 |
| status | text | NOT NULL | 'offline' | 状态 |
| approvalStatus | text | NOT NULL | 'pending' | 审批状态 |
| createdBy | text | NOT NULL | - | 创建人 |
| createdAt | timestamp(3) | NOT NULL | CURRENT_TIMESTAMP | 创建时间 |
| updatedAt | timestamp(3) | NOT NULL | - | 更新时间 |

**主键:** `id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| global_prompt_name_key | UNIQUE | name |

**外键:** 无

---

## 6. innovation_case（创新案例）

**说明:** 存储创新案例库

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| scene_type | varchar(32) | NOT NULL | - | 场景类型 |
| case_title | varchar(128) | NOT NULL | - | 案例标题 |
| core_demand | text | NOT NULL | - | 核心需求 |
| core_idea | text | NOT NULL | - | 核心创意 |
| create_time | timestamp(6) | - | CURRENT_TIMESTAMP | 创建时间 |

**主键:** `id`

**索引:** 无

**外键:** 无

**字段注释:**
- `scene_type`: 场景：product/marketing/service
- `core_demand`: 核心需求
- `core_idea`: 核心创意

---

## 7. innovation_method（创新方法）

**说明:** 存储创新方法论及其步骤

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| method_code | varchar(32) | NOT NULL | - | 方法编码 |
| method_name | varchar(64) | NOT NULL | - | 方法名称 |
| apply_scene | text | NOT NULL | - | 适用场景 |
| step_list | jsonb | NOT NULL | - | 步骤数组 |
| prompt_template | text | NOT NULL | - | 引导话术模板 |
| create_time | timestamp(6) | - | CURRENT_TIMESTAMP | 创建时间 |

**主键:** `id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| innovation_method_method_code_key | UNIQUE | method_code |

**外键:** 无

**字段注释:**
- `method_code`: 唯一编码：5w2h/scamper/brainstorm
- `apply_scene`: 适用场景
- `step_list`: 步骤数组 `[{step:1,question:"xxx"}]`
- `prompt_template`: 引导话术模板

---

## 8. Profile（用户资料）

**说明:** 存储用户个人资料信息

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | int4 | NOT NULL | 自增序列 | 主键 |
| name | text | NOT NULL | - | 姓名 |
| email | text | NOT NULL | - | 邮箱 |
| phone | text | - | - | 电话 |
| location | text | - | - | 所在地 |
| bio | text | - | - | 个人简介 |
| company | text | - | - | 公司 |
| position | text | - | - | 职位 |
| joinDate | timestamp(3) | NOT NULL | CURRENT_TIMESTAMP | 加入日期 |
| skills | text[] | - | ARRAY[]::text[] | 技能数组 |
| createdAt | timestamp(3) | NOT NULL | CURRENT_TIMESTAMP | 创建时间 |
| updatedAt | timestamp(3) | NOT NULL | - | 更新时间 |
| avatar | text | - | - | 头像URL |

**主键:** `id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| Profile_email_key | UNIQUE | email |

**外键:** 无

---

## 9. user_session（用户会话）

**说明:** 存储用户会话主信息

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|------|--------|------|
| session_id | varchar(64) | NOT NULL | - | 会话ID (主键) |
| user_input | text | NOT NULL | - | 用户初始需求 |
| current_status | varchar(32) | NOT NULL | 'analyze' | 当前状态 |
| current_step | int4 | - | 1 | 当前步骤 |
| create_time | timestamp(6) | - | CURRENT_TIMESTAMP | 创建时间 |
| update_time | timestamp(6) | - | CURRENT_TIMESTAMP | 更新时间 |

**主键:** `session_id`

**索引:**
| 索引名 | 类型 | 字段 |
|--------|------|------|
| idx_session_status | INDEX | current_status |

**外键:** 被 `creative_list` 和 `demand_anchor` 引用

**字段注释:**
- `user_input`: 用户初始需求
- `current_status`: analyze(拆解)/diverge(发散)/finish(完成)
- `current_step`: 当前执行步骤

---

## 表关系图

```
┌─────────────────┐
│  user_session  │
│─────────────────│
│ session_id (PK) │
│ user_input      │
│ current_status  │
│ current_step    │
└────────┬────────┘
         │
         │ 1:N
         ├──────────────────────┐
         │                      │
         ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│ creative_list   │    │ demand_anchor  │
│─────────────────│    │─────────────────│
│ id (PK)         │    │ id (PK)         │
│ session_id (FK) │    │ session_id (FK) │
│ content         │    │ target          │
│ sort            │    │ user_group      │
│                 │    │ constraint      │
└─────────────────┘    │ innovation_type │
                       └─────────────────┘
```

---

## 索引汇总

| 索引名 | 表名 | 类型 | 字段 |
|--------|------|------|------|
| AIConfig_provider_model_key | AIConfig | UNIQUE | provider, model |
| idx_creative_session | creative_list | INDEX | session_id |
| demand_anchor_session_id_key | demand_anchor | UNIQUE | session_id |
| global_prompt_name_key | global_prompt | UNIQUE | name |
| innovation_method_method_code_key | innovation_method | UNIQUE | method_code |
| Profile_email_key | Profile | UNIQUE | email |
| idx_session_status | user_session | INDEX | current_status |

**索引统计:** 共 7 个索引

---

## 统计数据

| 类型 | 数量 |
|------|------|
| 表总数 | 9 |
| 自增序列 | 7 |
| 唯一索引 | 6 |
| 普通索引 | 1 |
| 外键约束 | 2 |

---

*文档由 HexHub 自动生成*
