# Prompt 业务文档

## 一、业务逻辑及业务流程

### 1.1 系统概述

本项目是一个AI Prompt管理系统，支持多模块的Prompt配置和管理。系统采用前后端分离架构：
- **后端**：NestJS + Prisma ORM + PostgreSQL
- **前端**：React + TypeScript + Vite

### 1.2 核心业务模块

系统包含两大类Prompt管理模块：

#### 1.2.1 全局Prompt管理（GlobalPrompt）
- **定位**：独立的全局Prompt管理系统，支持完整的生命周期管理
- **特性**：
  - 版本控制：每次内容修改自动版本号+1
  - 状态管理：online（在线）/ offline（离线）
  - 审批流程：pending（待审批）→ approved（已通过）/ rejected（已驳回）
  - 单例约束：同一时刻系统中最多只有一个online状态的Prompt

#### 1.2.2 模块Prompt管理
包含四个功能模块的Prompt配置：
- **Perception（问题感知模块）**：配置问题理解和感知相关的提示词
- **Retrieval（知识检索模块）**：配置知识检索相关的提示词
- **Generation（创意生成模块）**：配置创意生成相关的提示词
- **Evaluation（评估反馈模块）**：配置评估反馈相关的提示词

这些模块的Prompt直接保存在AIConfig表中，与AI模型配置关联。

### 1.3 GlobalPrompt业务流程

#### 1.3.1 创建Prompt流程
```
用户点击"新建Prompt" 
  → 填写Prompt Key、名称、描述
  → 系统创建记录（默认状态：offline，审批状态：pending）
  → 进入编辑模式
  → 用户编写Prompt模板内容
  → 点击"保存"
```

**关键规则**：
- Prompt Key必须唯一
- 新创建的Prompt默认版本号为1
- 新创建的Prompt默认为offline状态，审批状态为pending

#### 1.3.2 编辑调试流程
```
选择已存在的Prompt
  → 点击"编辑"按钮
  → 进入编辑模式
  → 修改Prompt模板内容
  → 点击"保存"
  → 系统自动版本号+1
  → 审批状态重置为pending
```

**关键规则**：
- 已上线（online）的Prompt不允许直接修改内容
- 已审批通过（approved）的Prompt修改内容后，审批状态重置为pending
- 每次修改内容都会触发版本号自增

#### 1.3.3 提交审批流程
```
编辑完成的Prompt
  → 系统自动设置审批状态为pending
  → 管理员审核
  → 审批通过（approved）或驳回（rejected）
```

**审批状态流转**：
- `pending` → `approved`：审批通过
- `pending` → `rejected`：审批驳回
- `approved` → `pending`：退回待审（特殊操作）
- `rejected` → `pending`：重新提交

#### 1.3.4 版本管理与上线流程
```
审批通过的Prompt（approvalStatus=approved）
  → 点击"上线"按钮
  → 系统自动将其他online的Prompt下线
  → 当前Prompt上线（status=online）
  → 系统业务可调用此Prompt
```

**关键规则**：
- 只有审批通过（approved）的Prompt才能上线
- 上线时会自动将其他所有online状态的Prompt下线，确保系统同一时刻只有一个在线Prompt
- online状态的Prompt不允许删除
- online状态的Prompt不允许修改内容

#### 1.3.5 下线与删除流程
```
在线Prompt
  → 点击"下线"按钮
  → Prompt状态变为offline
  → 可以进行删除操作

离线Prompt
  → 点击"删除"按钮
  → 确认删除
  → Prompt记录从数据库删除
```

**关键规则**：
- online状态的Prompt必须先下线才能删除
- 删除操作不可逆

### 1.4 模块Prompt管理流程

```
选择功能模块（Perception/Retrieval/Generation/Evaluation）
  → 编辑Prompt内容
  → 测试AI连接（可选）
  → 保存配置
  → Prompt保存到AIConfig表中
```

**关键特性**：
- 这些模块的Prompt与AI模型配置绑定
- 支持全屏编辑模式
- 支持复制、清空等快捷操作

## 二、前后端交互逻辑

### 2.1 技术架构

#### 前端架构
```
frontend/
├── pages/admin/
│   ├── index.tsx                    # 管理后台主入口
│   ├── AdminLayout.tsx              # 后台布局组件
│   ├── ModelManagement.tsx          # 模型管理页面
│   ├── PromptManagement.tsx         # Prompt管理主组件（路由分发）
│   ├── globalPrompt/                # 全局Prompt模块
│   │   ├── GlobalSettings.tsx       # 全局Prompt列表与编辑器
│   │   ├── PromptList.tsx           # Prompt列表组件
│   │   ├── CreatePromptModal.tsx    # 创建Prompt模态框
│   │   ├── useGlobalPrompt.ts       # GlobalPrompt业务Hook
│   │   ├── api.ts                   # GlobalPrompt API服务
│   │   └── types.ts                 # 类型定义
│   ├── perception/                  # 问题感知模块
│   ├── retrieval/                   # 知识检索模块
│   ├── generation/                  # 创意生成模块
│   ├── evaluation/                  # 评估反馈模块
│   ├── hooks.ts                     # 共享Hooks
│   ├── api.ts                       # 共享API服务
│   └── types.ts                     # 共享类型定义
```

#### 后端架构
```
backend/src/
├── modules/
│   ├── global-prompt/               # 全局Prompt模块
│   │   ├── global-prompt.controller.ts  # 控制器（路由）
│   │   ├── global-prompt.service.ts     # 业务逻辑
│   │   ├── global-prompt.module.ts      # 模块定义
│   │   └── dto/                         # 数据传输对象
│   │       └── global-prompt.dto.ts
│   ├── ai-config/                   # AI配置模块
│   └── profile/                     # 用户信息模块
├── prisma/                          # 数据库服务
└── app.module.ts                    # 应用主模块
```

### 2.2 完整交互流程

#### 2.2.1 创建 Prompt → 编辑调试 → 提交版本 → 版本管理与业务集成

##### **步骤1：创建Prompt**
```mermaid
用户 → 前端：点击"新建Prompt"
前端 → 前端：弹出CreatePromptModal
用户 → 前端：填写表单（Prompt Key、名称、描述）
前端 → 前端：表单验证（PromptKey格式、长度限制）
前端 → 后端：POST /api/global-prompt
后端 → 后端：检查name唯一性
后端 → 数据库：创建GlobalPrompt记录
数据库 → 后端：返回新记录
后端 → 前端：返回创建的Prompt对象
前端 → 前端：进入编辑模式
前端 → 用户：显示Prompt编辑界面
```

**前端关键代码**：
- `CreatePromptModal.tsx`：表单验证和提交
- `useGlobalPrompt.ts`：`handleCreate`方法
- `api.ts`：`createPrompt` API调用

**后端关键代码**：
- `global-prompt.controller.ts`：`@Post()`路由
- `global-prompt.service.ts`：`create`方法
- 数据库：插入`GlobalPrompt`表

##### **步骤2：编辑调试**
```mermaid
用户 → 前端：在编辑器中编写Prompt内容
前端 → 前端：实时更新本地状态
用户 → 前端：点击"保存"按钮
前端 → 前端：校验内容非空
前端 → 后端：PUT /api/global-prompt/:id
后端 → 后端：校验当前状态
后端 → 后端：检查是否为online状态（online不允许修改）
后端 → 后端：检查是否为approved状态（approved修改需重置审批）
后端 → 数据库：更新Prompt内容，版本号+1
数据库 → 后端：返回更新后的Prompt
后端 → 前端：返回更新结果
前端 → 用户：显示保存成功提示
```

**业务规则**：
- online状态的Prompt不允许修改内容
- approved状态的Prompt修改后，审批状态重置为pending
- 每次修改内容，版本号自动+1

**前端关键代码**：
- `GlobalSettings.tsx`：编辑器组件
- `useGlobalPrompt.ts`：`handleUpdate`方法

**后端关键代码**：
- `global-prompt.service.ts`：`update`方法

##### **步骤3：提交版本（审批流程）**
```mermaid
用户 → 前端：编辑并保存Prompt
后端 → 数据库：保存时自动设置approvalStatus=pending
前端 → 后端：PATCH /api/global-prompt/:id/approval
后端 → 后端：校验审批状态转换合理性
后端 → 数据库：更新approvalStatus
数据库 → 后端：返回更新后的Prompt
后端 → 前端：返回结果
前端 → 用户：显示审批结果
```

**审批状态转换规则**：
- `pending` → `approved`：审批通过
- `pending` → `rejected`：审批驳回
- `approved` → `pending`：退回待审
- `rejected` → `pending`：重新提交

**后端关键代码**：
- `global-prompt.service.ts`：`updateApproval`方法

##### **步骤4：版本管理与业务集成（上线）**
```mermaid
用户 → 前端：点击"上线"按钮
前端 → 前端：弹出确认框
用户 → 前端：确认上线
前端 → 后端：PATCH /api/global-prompt/:id/status {status: "online"}
后端 → 后端：校验审批状态（必须为approved）
后端 → 数据库：事务操作
  ├─ 将所有其他online的Prompt设为offline
  └─ 将当前Prompt设为online
数据库 → 后端：返回更新结果
后端 → 前端：返回online状态的Prompt
前端 → 用户：显示上线成功提示
```

**关键业务规则**：
- 只有approved状态的Prompt才能上线
- 上线时会自动将其他所有online的Prompt下线
- 确保系统同一时刻只有一个online的Prompt

**前端关键代码**：
- `PromptList.tsx`：`handleOnline`方法
- `useGlobalPrompt.ts`：`handleOnline`方法

**后端关键代码**：
- `global-prompt.service.ts`：`updateStatus`方法（使用事务）

##### **步骤5：业务系统集成**
```mermaid
业务系统 → 后端：GET /api/global-prompt/online
后端 → 数据库：查询status=online的Prompt
数据库 → 后端：返回Prompt对象
后端 → 业务系统：返回templateContent
业务系统 → 业务系统：使用Prompt进行AI交互
```

**后端关键代码**：
- `global-prompt.controller.ts`：`@Get('online')`路由
- `global-prompt.service.ts`：`findOnline`方法

### 2.3 状态管理

#### 前端状态管理
使用React Hooks进行状态管理：

**GlobalPrompt状态**（`useGlobalPrompt.ts`）：
```typescript
{
  prompts: GlobalPrompt[];              // Prompt列表
  loading: boolean;                     // 加载状态
  error: string | null;                 // 错误信息
  currentEditingPrompt: GlobalPrompt | null;  // 当前编辑的Prompt
  isEditing: boolean;                   // 是否处于编辑模式
}
```

**Prompt内容状态**（`hooks.ts` - `usePromptManagement`）：
```typescript
{
  prompts: Record<PromptModule, string>;  // 各模块的Prompt内容
  activeModule: PromptModule;             // 当前激活的模块
  saveStatus: SaveStatus;                 // 保存状态
  isFullscreen: boolean;                  // 是否全屏
  editingGlobalPromptId: number | null;   // 当前编辑的GlobalPrompt ID
}
```

#### 后端数据模型
**GlobalPrompt表**（`schema.prisma`）：
```typescript
{
  id: number;                    // 主键
  name: string;                  // 业务标识（唯一）
  templateContent: string;       // Prompt模板内容
  version: number;               // 版本号
  status: string;                // online | offline
  approvalStatus: string;        // pending | approved | rejected
  createdBy: string;             // 创建者
  createdAt: DateTime;           // 创建时间
  updatedAt: DateTime;           // 更新时间
}
```

### 2.4 错误处理机制

#### 前端错误处理
1. **表单验证**：在提交前进行客户端验证
   - PromptKey格式验证（字母、数字、下划线、连字符）
   - 长度限制验证
   - 必填字段验证

2. **API错误捕获**：
   ```typescript
   try {
     const result = await globalPromptApi.updatePrompt(id, data);
     // 成功处理
   } catch (err) {
     const errorMessage = err instanceof Error ? err.message : '默认错误提示';
     setError(errorMessage);
     alert(errorMessage);
   }
   ```

3. **用户友好提示**：
   - 使用`alert()`显示操作结果
   - 使用`window.confirm()`进行危险操作确认

#### 后端错误处理
1. **异常抛出**：
   ```typescript
   throw new BadRequestException('错误信息');
   throw new NotFoundException('资源不存在');
   throw new ConflictException('资源冲突');
   ```

2. **业务规则校验**：
   - 检查状态转换的合理性
   - 检查唯一性约束
   - 检查操作权限

3. **日志记录**：
   ```typescript
   this.logger.log('操作日志');
   this.logger.warn('警告日志');
   this.logger.error('错误日志');
   ```

## 三、接口清单

### 3.1 GlobalPrompt API

#### 3.1.1 创建全局Prompt
- **接口**：`POST /api/global-prompt`
- **描述**：创建新的全局Prompt记录
- **请求体**：
  ```json
  {
    "name": "system_default",
    "templateContent": "Prompt模板内容（可选）",
    "createdBy": "admin"
  }
  ```
- **响应**：
  ```json
  {
    "id": 1,
    "name": "system_default",
    "templateContent": "Prompt模板内容",
    "version": 1,
    "status": "offline",
    "approvalStatus": "pending",
    "createdBy": "admin",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
  ```
- **错误码**：
  - 400：参数验证失败（name或createdBy为空）
  - 409：Prompt名称已存在

#### 3.1.2 查询Prompt列表
- **接口**：`GET /api/global-prompt`
- **描述**：查询所有Prompt列表，支持筛选
- **查询参数**：
  - `status`：按状态筛选（online | offline）
  - `approvalStatus`：按审批状态筛选（pending | approved | rejected）
- **示例**：`GET /api/global-prompt?status=offline&approvalStatus=pending`
- **响应**：
  ```json
  [
    {
      "id": 1,
      "name": "system_default",
      "templateContent": "...",
      "version": 2,
      "status": "offline",
      "approvalStatus": "pending",
      "createdBy": "admin",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T01:00:00.000Z"
    }
  ]
  ```

#### 3.1.3 获取当前在线的Prompt
- **接口**：`GET /api/global-prompt/online`
- **描述**：获取当前online状态的Prompt（业务系统调用入口）
- **响应**：
  ```json
  {
    "id": 1,
    "name": "system_default",
    "templateContent": "AI提示词内容...",
    "version": 3,
    "status": "online",
    "approvalStatus": "approved",
    "createdBy": "admin",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T02:00:00.000Z"
  }
  ```
- **说明**：如果没有在线的Prompt，返回`null`

#### 3.1.4 按名称查询Prompt
- **接口**：`GET /api/global-prompt/name/:name`
- **描述**：根据Prompt名称查询详情
- **路径参数**：`name` - Prompt业务标识
- **示例**：`GET /api/global-prompt/name/system_default`
- **响应**：同单个Prompt对象
- **错误码**：404：Prompt不存在

#### 3.1.5 按ID查询Prompt
- **接口**：`GET /api/global-prompt/:id`
- **描述**：根据ID查询Prompt详情
- **路径参数**：`id` - Prompt ID
- **示例**：`GET /api/global-prompt/1`
- **响应**：同单个Prompt对象
- **错误码**：404：Prompt不存在

#### 3.1.6 更新Prompt内容
- **接口**：`PUT /api/global-prompt/:id`
- **描述**：更新Prompt内容或名称
- **路径参数**：`id` - Prompt ID
- **请求体**：
  ```json
  {
    "name": "new_name",
    "templateContent": "新的Prompt内容",
    "createdBy": "admin"
  }
  ```
- **响应**：更新后的Prompt对象（版本号自动+1）
- **业务规则**：
  - 修改内容时，如果当前状态为online，抛出400错误
  - 修改内容时，如果审批状态为approved，重置为pending
  - 修改内容时，版本号自动+1
  - 仅修改名称时，不触发版本号变更
- **错误码**：
  - 400：online状态不允许修改内容 / 已审批通过的Prompt不允许修改内容
  - 404：Prompt不存在

#### 3.1.7 更新Prompt状态（上线/下线）
- **接口**：`PATCH /api/global-prompt/:id/status`
- **描述**：更新Prompt的在线状态
- **路径参数**：`id` - Prompt ID
- **请求体**：
  ```json
  {
    "status": "online"
  }
  ```
- **响应**：更新后的Prompt对象
- **业务规则**：
  - 上线时，必须先审批通过（approvalStatus=approved）
  - 上线时，自动将其他所有online的Prompt下线（使用事务确保一致性）
  - 下线操作无限制
- **错误码**：
  - 400：仅审批通过的Prompt才能上线
  - 404：Prompt不存在

#### 3.1.8 更新审批状态
- **接口**：`PATCH /api/global-prompt/:id/approval`
- **描述**：更新Prompt的审批状态
- **路径参数**：`id` - Prompt ID
- **请求体**：
  ```json
  {
    "approvalStatus": "approved"
  }
  ```
- **响应**：更新后的Prompt对象
- **审批状态值**：
  - `approved`：审批通过
  - `rejected`：审批驳回
  - `pending`：退回待审
- **错误码**：404：Prompt不存在

#### 3.1.9 删除Prompt
- **接口**：`DELETE /api/global-prompt/:id`
- **描述**：删除Prompt记录
- **路径参数**：`id` - Prompt ID
- **响应**：被删除的Prompt对象
- **业务规则**：online状态的Prompt不允许删除
- **错误码**：
  - 400：online状态的Prompt不允许删除，请先下线
  - 404：Prompt不存在

### 3.2 AIConfig API

#### 3.2.1 测试AI连接
- **接口**：`POST /ai-config/test`
- **描述**：测试AI模型连接是否正常
- **请求体**：
  ```json
  {
    "apiKey": "sk-...",
    "provider": "openai",
    "model": "gpt-4"
  }
  ```
- **响应**：
  ```json
  {
    "message": "连接成功",
    "responseTime": 1200,
    "success": true
  }
  ```

#### 3.2.2 保存AI配置
- **接口**：`POST /ai-config/save`
- **描述**：保存AI配置及Prompt
- **请求体**：
  ```json
  {
    "apiKey": "sk-...",
    "provider": "openai",
    "model": "gpt-4",
    "prompt": "Prompt内容",
    "lastTestInput": "连接测试",
    "lastTestResult": "连接成功",
    "lastTestTime": "2024-01-01T00:00:00.000Z"
  }
  ```
- **响应**：
  ```json
  {
    "id": 1
  }
  ```

#### 3.2.3 获取最新配置
- **接口**：`GET /ai-config/latest`
- **描述**：获取最新的AI配置
- **响应**：
  ```json
  {
    "id": 1,
    "apiKey": "sk-...",
    "provider": "openai",
    "model": "gpt-4",
    "prompt": "Prompt内容",
    "lastTestInput": "连接测试",
    "lastTestResult": "连接成功",
    "lastTestTime": "2024-01-01T00:00:00.000Z",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
  ```

#### 3.2.4 其他AIConfig接口
- `GET /ai-config`：获取所有配置列表
- `GET /ai-config/:id`：按ID获取配置
- `GET /ai-config/provider/:provider/model/:model`：按服务商和模型查询
- `PUT /ai-config/:id`：更新配置
- `DELETE /ai-config/:id`：删除配置

### 3.3 接口调用流程图

#### 完整业务流程
```
创建阶段：
前端 → POST /api/global-prompt → 后端创建Prompt

编辑阶段：
前端 → GET /api/global-prompt/:id → 后端返回Prompt详情
前端 → PUT /api/global-prompt/:id → 后端更新内容（版本+1）

审批阶段：
前端 → PATCH /api/global-prompt/:id/approval → 后端更新审批状态

上线阶段：
前端 → PATCH /api/global-prompt/:id/status {status: "online"} 
    → 后端校验审批状态 
    → 后端事务：下线其他 + 上线当前 
    → 返回结果

业务集成：
业务系统 → GET /api/global-prompt/online → 获取在线Prompt → 使用

下线/删除：
前端 → PATCH /api/global-prompt/:id/status {status: "offline"} → 下线
前端 → DELETE /api/global-prompt/:id → 删除（必须先下线）
```

## 四、数据字典

### 4.1 GlobalPrompt状态说明

#### status字段
- `online`：在线状态，表示当前Prompt正在被业务系统使用
- `offline`：离线状态，表示Prompt未被使用

#### approvalStatus字段
- `pending`：待审批状态，新创建或修改后的默认状态
- `approved`：已审批通过，可以上线使用
- `rejected`：审批驳回，需要修改后重新提交

### 4.2 PromptModule枚举
- `perception`：问题感知模块
- `retrieval`：知识检索模块
- `generation`：创意生成模块
- `evaluation`：评估反馈模块
- `global-settings`：全局Prompt设置

### 4.3 SaveStatus状态
- `idle`：空闲状态
- `saving`：保存中
- `saved`：已保存
- `error`：保存失败

## 五、关键技术实现

### 5.1 版本控制实现
后端在`update`方法中自动处理版本号：
```typescript
// 每次修改内容，版本号自增
const newVersion = prompt.version + 1;
await this.prisma.globalPrompt.update({
  where: { id },
  data: {
    templateContent: dto.templateContent,
    version: newVersion,
    approvalStatus: 'pending', // 重置审批状态
  },
});
```

### 5.2 单例约束实现
使用数据库事务确保同一时刻只有一个online的Prompt：
```typescript
await this.prisma.$transaction(async (prisma) => {
  // 1. 将所有其他online的Prompt设为offline
  await prisma.globalPrompt.updateMany({
    where: { status: 'online', id: { not: id } },
    data: { status: 'offline' },
  });
  
  // 2. 将当前Prompt设为online
  return prisma.globalPrompt.update({
    where: { id },
    data: { status: dto.status },
  });
});
```

### 5.3 前端状态同步
使用React Hook管理状态，确保UI与数据一致：
```typescript
const handleUpdate = async (id: number, data: UpdatePromptData) => {
  const updatedPrompt = await globalPromptApi.updatePrompt(id, data);
  // 更新本地状态
  setPrompts(prev => prev.map(p => p.id === id ? updatedPrompt : p));
  return updatedPrompt;
};
```

## 六、安全考虑

### 6.1 权限控制
- 所有管理操作需要管理员权限
- 审批操作需要特定权限（目前代码中未实现，建议添加）

### 6.2 数据验证
- 前端：表单验证，防止无效输入
- 后端：DTO验证，使用`class-validator`进行参数校验

### 6.3 操作审计
- 所有操作都有日志记录
- 记录创建者、创建时间、更新时间

### 6.4 并发控制
- 使用数据库事务确保操作原子性
- 上线操作使用事务确保单例约束

## 七、最佳实践建议

### 7.1 Prompt命名规范
建议使用有意义的命名规范，例如：
- `system_default_v1`：系统默认Prompt版本1
- `customer_service_bot`：客服机器人Prompt
- `product_recommendation`：商品推荐Prompt

### 7.2 版本管理建议
- 重要修改前先备份当前版本
- 版本号自增，不可回退
- 使用版本号追溯历史变更

### 7.3 审批流程建议
- 建立明确的审批标准
- 驳回时提供详细的修改建议
- 审批通过后及时上线

### 7.4 监控与告警
- 监控online状态Prompt的使用情况
- 设置Prompt内容变更告警
- 定期备份Prompt数据

## 八、未来扩展方向

### 8.1 功能扩展
- 支持Prompt模板变量
- 支持Prompt测试功能
- 支持Prompt版本对比
- 支持Prompt回滚
- 支持多环境管理（开发、测试、生产）

### 8.2 技术优化
- 引入Redis缓存在线Prompt
- 实现更细粒度的权限控制
- 添加操作审计日志表
- 实现Prompt性能监控
- 支持Prompt A/B测试

### 8.3 用户体验
- 添加Markdown编辑器支持
- 实现Prompt预览功能
- 添加Prompt模板库
- 支持Prompt导入导出

---

## 九、业务问题与风险分析

经过全面的代码审查和业务逻辑分析，发现以下问题和风险点：

### 9.1 安全性问题 🔴 **严重**

#### 9.1.1 API Key明文存储
**问题描述**：
- API Key以明文形式存储在数据库的`AIConfig`表中
- 前端使用`localStorage`缓存API Key（`admin/api.ts`中的`configCache`）
- 后端日志中可能泄露敏感信息

**风险等级**：🔴 高危

**代码位置**：
```typescript
// frontend/pages/admin/api.ts
export const configCache = {
  set(config: AIConfig): void {
    localStorage.setItem('aiConfig', JSON.stringify(config));
    // API Key明文存储在localStorage
  }
}

// backend/prisma/schema.prisma
model AIConfig {
  apiKey    String  // 明文存储，未加密
}
```

**安全风险**：
1. 数据库泄露会导致所有API Key暴露
2. XSS攻击可窃取localStorage中的API Key
3. 浏览器开发者工具可直接查看API Key
4. 日志文件可能记录API Key

#### 9.1.2 缺少权限控制
**问题描述**：
- 所有API接口都没有权限验证中间件
- 任何用户都可以执行创建、修改、删除、审批等操作
- 没有用户角色管理

**风险等级**：🔴 高危

**代码位置**：
```typescript
// backend/src/modules/global-prompt/global-prompt.controller.ts
@Post()
create(@Body() dto: CreateGlobalPromptDto) {
  // 没有权限验证，任何人都可以创建
  return this.globalPromptService.create(dto);
}

@Patch(':id/approval')
updateApproval(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateApprovalDto) {
  // 没有权限验证，任何人都可以审批
  return this.globalPromptService.updateApproval(id, dto);
}
```

### 9.2 数据一致性问题 🟡 **中等**

#### 9.2.1 前后端字段不一致
**问题描述**：
- 前端`types.ts`定义了`promptKey`和`description`字段
- 数据库schema中没有这些字段
- 导致前端表单数据无法保存

**代码位置**：
```typescript
// frontend/pages/admin/globalPrompt/types.ts
export interface GlobalPrompt {
  id: number;
  name: string;
  promptKey?: string;        // ❌ 数据库中不存在
  description?: string;       // ❌ 数据库中不存在
  templateContent: string;
  // ...
}

// backend/prisma/schema.prisma
model GlobalPrompt {
  id              Int      @id @default(autoincrement())
  name            String   @unique
  templateContent String
  // ❌ 缺少 promptKey 和 description 字段
}
```

**影响**：
- 前端创建Prompt时填写的"描述"信息丢失
- Prompt Key字段在前端表单中显示，但实际未使用

#### 9.2.2 数据库字段缺失
**问题描述**：
- 缺少`description`字段：无法记录Prompt的用途说明
- 缺少`updatedBy`字段：无法追踪最后修改人
- 缺少审批相关字段：审批人、审批时间、审批意见

**建议字段**：
```prisma
model GlobalPrompt {
  // ... 现有字段
  description     String?   // Prompt描述说明
  updatedBy       String?   // 最后修改人
  approvedBy      String?   // 审批人
  approvedAt      DateTime? // 审批时间
  approvalComment String?   // 审批意见
}
```

### 9.3 业务逻辑问题 🟡 **中等**

#### 9.3.1 前端逻辑重复与混乱
**问题描述**：
- `hooks.ts`中的`usePromptManagement`对global-settings有特殊处理逻辑
- `GlobalSettings.tsx`组件也独立实现了GlobalPrompt的完整管理
- 两套逻辑并存，容易造成混乱

**代码位置**：
```typescript
// frontend/pages/admin/hooks.ts - handleSavePrompt方法
if (module === 'global-settings') {
  // 这里有一套GlobalPrompt保存逻辑
  const { globalPromptApi } = await import('./globalPrompt/api');
  if (editingGlobalPromptId) {
    await globalPromptApi.updatePrompt(editingGlobalPromptId, {...});
  } else {
    await globalPromptApi.createPrompt({...});
  }
}

// frontend/pages/admin/globalPrompt/GlobalSettings.tsx - handleSavePrompt方法
const result = await handleUpdate(currentEditingPrompt.id, {
  templateContent: prompts['global-settings'].trim(),
  createdBy: 'admin',
});
// 这里又有一套逻辑
```

**问题**：
1. 逻辑重复，难以维护
2. 两个地方的状态可能不一致
3. 用户可能走不同的逻辑路径，行为不一致

#### 9.3.2 审批流程不完整
**问题描述**：
- 没有审批历史记录表
- 无法查看审批过程
- 缺少审批意见字段
- 没有审批通知机制

**现状**：
```typescript
// 只有一个简单的状态更新
async updateApproval(id: number, dto: UpdateApprovalDto) {
  return this.prisma.globalPrompt.update({
    where: { id },
    data: { approvalStatus: dto.approvalStatus },
    // ❌ 没有记录审批人、审批时间、审批意见
  });
}
```

#### 9.3.3 版本管理不完善
**问题描述**：
- 只有版本号字段，没有历史版本表
- 无法查看历史版本内容
- 无法对比版本差异
- 无法回滚到历史版本

**建议设计**：
```prisma
model GlobalPromptVersion {
  id              Int      @id @default(autoincrement())
  promptId        Int
  version         Int
  templateContent String
  createdBy       String
  createdAt       DateTime @default(now())
  
  prompt          GlobalPrompt @relation(fields: [promptId], references: [id])
}

model GlobalPrompt {
  // ... 现有字段
  versions        GlobalPromptVersion[]
}
```

### 9.4 功能缺失问题 🟢 **一般**

#### 9.4.1 缺少分页功能
**问题描述**：
- `GET /api/global-prompt`返回所有记录，没有分页
- 数据量大时会影响性能

**代码位置**：
```typescript
// backend/src/modules/global-prompt/global-prompt.service.ts
async findAll(filters?: { status?: string; approvalStatus?: string }) {
  return this.prisma.globalPrompt.findMany({
    // ❌ 没有分页参数
    where: { ... },
    orderBy: { updatedAt: 'desc' },
  });
}
```

#### 9.4.2 缺少搜索功能
**问题描述**：
- 无法按名称、内容等关键字搜索
- 无法按创建人、时间范围筛选

#### 9.4.3 缺少Prompt测试功能
**问题描述**：
- AIConfig模块有`testConnection`功能，可以测试AI连接
- 但GlobalPrompt模块没有Prompt测试功能
- 用户无法在上线前测试Prompt效果

#### 9.4.4 缺少操作审计日志
**问题描述**：
- 没有专门的操作日志表
- 只能通过数据库日志追溯操作
- 无法查看"谁在什么时间做了什么操作"

### 9.5 用户体验问题 🟢 **一般**

#### 9.5.1 编辑器功能简陋
**问题描述**：
- 只是一个简单的`<textarea>`
- 没有Markdown预览
- 没有语法高亮
- 没有自动保存功能

#### 9.5.2 缺少操作确认和引导
**问题描述**：
- 使用原生`alert()`和`confirm()`提示用户
- 体验不够友好
- 没有操作引导和帮助信息

#### 9.5.3 错误提示不友好
**问题描述**：
```typescript
// 前端错误处理
catch (err) {
  const errorMessage = err instanceof Error ? err.message : '默认错误提示';
  setError(errorMessage);
  alert(errorMessage);  // ❌ 使用原生alert
}
```

### 9.6 性能问题 🟢 **一般**

#### 9.6.1 缺少缓存机制
**问题描述**：
- `GET /api/global-prompt/online`接口没有缓存
- 每次调用都会查询数据库
- 高频调用时会影响性能

**建议**：
```typescript
// 使用Redis缓存online状态的Prompt
const CACHE_KEY = 'global_prompt:online';
const CACHE_TTL = 300; // 5分钟

async findOnline() {
  // 先从缓存读取
  const cached = await this.cacheManager.get(CACHE_KEY);
  if (cached) return cached;
  
  // 缓存不存在，查询数据库
  const prompt = await this.prisma.globalPrompt.findFirst({
    where: { status: 'online' },
  });
  
  // 写入缓存
  if (prompt) {
    await this.cacheManager.set(CACHE_KEY, prompt, CACHE_TTL);
  }
  
  return prompt;
}
```

#### 9.6.2 前端状态管理不优化
**问题描述**：
- 每次切换模块都会重新渲染
- 没有使用状态管理库（如Redux、Zustand）
- 大型应用时可能影响性能

### 9.7 代码规范问题 🟢 **一般**

#### 9.7.1 硬编码问题
**问题描述**：
```typescript
// 多处硬编码
createdBy: 'admin',  // ❌ 应该从用户上下文获取
API_BASE_URL = 'http://localhost:3000'  // ❌ 应该使用环境变量
```

#### 9.7.2 缺少环境变量管理
**问题描述**：
- 没有使用`.env`文件管理环境变量
- API地址、数据库连接等硬编码在代码中

#### 9.7.3 缺少单元测试
**问题描述**：
- 后端Service层没有单元测试
- 前端Hook没有测试
- 关键业务逻辑没有测试覆盖

---

## 十、迭代优化建议

### 10.1 紧急修复（P0 - 立即处理）

#### 10.1.1 API Key加密存储 🔴
**方案**：
1. 使用AES加密算法加密API Key
2. 加密密钥存储在环境变量中
3. 前端不缓存API Key，改为Session Storage或内存存储

**实现步骤**：
```typescript
// 1. 添加加密工具类
import * as crypto from 'crypto';

export class CryptoUtil {
  private static algorithm = 'aes-256-cbc';
  private static key = process.env.ENCRYPTION_KEY; // 从环境变量读取
  
  static encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }
  
  static decrypt(text: string): string {
    const [ivHex, encryptedHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }
}

// 2. 在Service中使用
async saveConfig(dto: CreateAiConfigDto) {
  return this.prisma.aIConfig.create({
    data: {
      ...dto,
      apiKey: CryptoUtil.encrypt(dto.apiKey), // 加密存储
    },
  });
}
```

#### 10.1.2 添加权限验证中间件 🔴
**方案**：
1. 实现JWT认证中间件
2. 添加角色权限守卫
3. 关键操作需要管理员权限

**实现步骤**：
```typescript
// 1. 创建认证守卫
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;
    // 验证token，解析用户信息
    return this.validateToken(token);
  }
}

// 2. 创建角色守卫
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<Role[]>(
      'roles',
      context.getHandler()
    );
    if (!requiredRoles) return true;
    
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    return requiredRoles.some(role => user.roles.includes(role));
  }
}

// 3. 在Controller中使用
@Post()
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
create(@Body() dto: CreateGlobalPromptDto, @User() user: any) {
  return this.globalPromptService.create(dto, user.id);
}

@Patch(':id/approval')
@UseGuards(AuthGuard, RolesGuard)
@Roles('approver', 'admin')
updateApproval(@Param('id') id: number, @Body() dto: UpdateApprovalDto, @User() user: any) {
  return this.globalPromptService.updateApproval(id, dto, user.id);
}
```

### 10.2 重要优化（P1 - 近期处理）

#### 10.2.1 修复前后端字段不一致 🟡
**方案**：
1. 更新数据库schema，添加缺失字段
2. 使用数据库迁移工具同步
3. 更新前端类型定义

**实现步骤**：
```prisma
// 1. 更新 schema.prisma
model GlobalPrompt {
  id              Int      @id @default(autoincrement())
  name            String   @unique
  description     String?  // ✅ 添加描述字段
  templateContent String
  version         Int      @default(1)
  status          String   @default("offline")
  approvalStatus  String   @default("pending")
  createdBy       String
  updatedBy       String?  // ✅ 添加修改人字段
  approvedBy      String?  // ✅ 添加审批人字段
  approvedAt      DateTime? // ✅ 添加审批时间
  approvalComment String?  // ✅ 添加审批意见
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("global_prompt")
}

// 2. 运行数据库迁移
npx prisma migrate dev --name add_prompt_fields
```

#### 10.2.2 重构前端逻辑 🟡
**方案**：
1. 统一GlobalPrompt管理逻辑
2. 清理`hooks.ts`中的重复代码
3. 使用单一数据流

**重构方案**：
```typescript
// 删除 hooks.ts 中对 global-settings 的特殊处理
// 统一使用 globalPrompt/useGlobalPrompt.ts 管理

// frontend/pages/admin/hooks.ts
export function usePromptManagement() {
  const [prompts, setPrompts] = useState<Record<PromptModule, string>>({...});
  
  const handleSavePrompt = async (
    module: PromptModule,
    apiKey: string,
    provider: string,
    model: string,
    testResult: TestResult | null
  ) => {
    // ❌ 删除 global-settings 的特殊处理
    // if (module === 'global-settings') { ... }
    
    // ✅ 统一保存到 AIConfig（除 global-settings 外）
    if (module !== 'global-settings') {
      const configData: AIConfig = {...};
      const saved = await adminApi.saveConfig(configData);
      // ...
    }
  };
}

// global-settings 完全由 GlobalSettings 组件管理
// 避免逻辑重复
```

#### 10.2.3 完善审批流程 🟡
**方案**：
1. 添加审批历史表
2. 记录审批人和审批意见
3. 实现审批通知

**数据库设计**：
```prisma
model ApprovalHistory {
  id              Int      @id @default(autoincrement())
  promptId        Int
  action          String   // approved | rejected | resubmit
  previousStatus  String
  newStatus       String
  operator        String   // 审批人
  comment         String?  // 审批意见
  createdAt       DateTime @default(now())
  
  prompt          GlobalPrompt @relation(fields: [promptId], references: [id])
  
  @@map("approval_history")
}

model GlobalPrompt {
  // ... 现有字段
  approvalHistory ApprovalHistory[]
}
```

**后端实现**：
```typescript
async updateApproval(id: number, dto: UpdateApprovalDto, userId: string) {
  const prompt = await this.findOne(id);
  
  // 使用事务记录审批历史
  return this.prisma.$transaction(async (prisma) => {
    // 1. 更新Prompt状态
    const updated = await prisma.globalPrompt.update({
      where: { id },
      data: {
        approvalStatus: dto.approvalStatus,
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });
    
    // 2. 记录审批历史
    await prisma.approvalHistory.create({
      data: {
        promptId: id,
        action: dto.approvalStatus,
        previousStatus: prompt.approvalStatus,
        newStatus: dto.approvalStatus,
        operator: userId,
        comment: dto.comment,
      },
    });
    
    return updated;
  });
}
```

#### 10.2.4 实现版本历史管理 🟡
**方案**：
1. 添加版本历史表
2. 每次修改保存历史版本
3. 支持版本对比和回滚

**数据库设计**：
```prisma
model GlobalPromptVersion {
  id              Int      @id @default(autoincrement())
  promptId        Int
  version         Int
  templateContent String
  changeLog       String?  // 变更说明
  createdBy       String
  createdAt       DateTime @default(now())
  
  prompt          GlobalPrompt @relation(fields: [promptId], references: [id], onDelete: Cascade)
  
  @@unique([promptId, version])
  @@map("global_prompt_version")
}

model GlobalPrompt {
  // ... 现有字段
  versions        GlobalPromptVersion[]
}
```

**后端实现**：
```typescript
async update(id: number, dto: UpdateGlobalPromptDto, userId: string) {
  const prompt = await this.findOne(id);
  
  if (dto.templateContent !== undefined) {
    // 使用事务保存历史版本
    return this.prisma.$transaction(async (prisma) => {
      // 1. 保存当前版本到历史表
      await prisma.globalPromptVersion.create({
        data: {
          promptId: id,
          version: prompt.version,
          templateContent: prompt.templateContent,
          createdBy: prompt.createdBy,
        },
      });
      
      // 2. 更新当前记录
      return prisma.globalPrompt.update({
        where: { id },
        data: {
          templateContent: dto.templateContent,
          version: prompt.version + 1,
          approvalStatus: 'pending',
          updatedBy: userId,
        },
      });
    });
  }
  
  // 其他更新逻辑...
}
```

### 10.3 功能增强（P2 - 后续迭代）

#### 10.3.1 添加分页和搜索功能 🟢
**后端实现**：
```typescript
async findAll(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  approvalStatus?: string;
  keyword?: string;
  createdBy?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const { page = 1, pageSize = 20, ...filters } = params;
  
  const where = {
    ...(filters.status && { status: filters.status }),
    ...(filters.approvalStatus && { approvalStatus: filters.approvalStatus }),
    ...(filters.keyword && {
      OR: [
        { name: { contains: filters.keyword } },
        { templateContent: { contains: filters.keyword } },
      ],
    }),
    ...(filters.createdBy && { createdBy: filters.createdBy }),
    ...(filters.startDate && { createdAt: { gte: filters.startDate } }),
    ...(filters.endDate && { createdAt: { lte: filters.endDate } }),
  };
  
  const [items, total] = await Promise.all([
    this.prisma.globalPrompt.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    this.prisma.globalPrompt.count({ where }),
  ]);
  
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
```

#### 10.3.2 添加Prompt测试功能 🟢
**方案**：
- 在编辑器中添加"测试"按钮
- 使用当前的AI配置测试Prompt效果
- 显示测试结果和响应时间

**前端实现**：
```typescript
// 添加测试Hook
const handleTestPrompt = async (promptContent: string) => {
  if (!isConnectionValid) {
    alert('请先测试AI连接');
    return;
  }
  
  setTestStatus('testing');
  try {
    const result = await adminApi.testPrompt({
      apiKey,
      provider,
      model,
      prompt: promptContent,
    });
    
    setTestResult(result);
    setTestStatus('success');
  } catch (error) {
    setTestStatus('error');
    setTestResult({ error: error.message });
  }
};
```

#### 10.3.3 添加操作审计日志 🟢
**数据库设计**：
```prisma
model OperationLog {
  id          Int      @id @default(autoincrement())
  module      String   // global-prompt | ai-config
  action      String   // create | update | delete | approve | online
  resourceId  Int
  operator    String
  details     Json?    // 操作详情
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())
  
  @@map("operation_log")
}
```

#### 10.3.4 优化编辑器体验 🟢
**方案**：
- 集成Markdown编辑器（如Monaco Editor）
- 添加语法高亮
- 实现自动保存功能
- 添加Prompt模板库

### 10.4 性能优化（P2 - 后续迭代）

#### 10.4.1 添加Redis缓存 🟢
**实现方案**：
```typescript
import { Cache } from 'cache-manager';

@Injectable()
export class GlobalPromptService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}
  
  async findOnline() {
    const CACHE_KEY = 'global_prompt:online';
    const CACHE_TTL = 300; // 5分钟
    
    // 1. 尝试从缓存读取
    const cached = await this.cacheManager.get<GlobalPrompt>(CACHE_KEY);
    if (cached) {
      this.logger.log('从缓存获取online Prompt');
      return cached;
    }
    
    // 2. 缓存不存在，查询数据库
    const prompt = await this.prisma.globalPrompt.findFirst({
      where: { status: 'online' },
    });
    
    // 3. 写入缓存
    if (prompt) {
      await this.cacheManager.set(CACHE_KEY, prompt, CACHE_TTL);
      this.logger.log('Prompt已写入缓存');
    }
    
    return prompt;
  }
  
  // 上线/下线时清除缓存
  async updateStatus(id: number, dto: UpdateStatusDto) {
    const result = await this.prisma.$transaction(async (prisma) => {
      // ... 现有逻辑
    });
    
    // 清除缓存
    await this.cacheManager.del('global_prompt:online');
    
    return result;
  }
}
```

#### 10.4.2 数据库索引优化 🟢
**方案**：
```prisma
model GlobalPrompt {
  // ... 字段定义
  
  @@index([status])              // 按状态查询
  @@index([approvalStatus])      // 按审批状态查询
  @@index([createdBy])           // 按创建人查询
  @@index([updatedAt])           // 按更新时间排序
  @@index([status, approvalStatus])  // 复合索引
}
```

### 10.5 代码质量提升（P2 - 后续迭代）

#### 10.5.1 添加单元测试 🟢
**后端测试示例**：
```typescript
describe('GlobalPromptService', () => {
  let service: GlobalPromptService;
  let prisma: PrismaService;
  
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GlobalPromptService,
        {
          provide: PrismaService,
          useValue: {
            globalPrompt: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();
    
    service = module.get<GlobalPromptService>(GlobalPromptService);
    prisma = module.get<PrismaService>(PrismaService);
  });
  
  describe('create', () => {
    it('应该成功创建Prompt', async () => {
      const dto = {
        name: 'test_prompt',
        templateContent: 'test content',
        createdBy: 'admin',
      };
      
      const expected = { id: 1, ...dto, version: 1, status: 'offline' };
      jest.spyOn(prisma.globalPrompt, 'create').mockResolvedValue(expected as any);
      
      const result = await service.create(dto);
      
      expect(result).toEqual(expected);
      expect(prisma.globalPrompt.create).toHaveBeenCalledWith({
        data: { ...dto, templateContent: dto.templateContent },
      });
    });
    
    it('应该拒绝重复的名称', async () => {
      const dto = {
        name: 'existing_prompt',
        templateContent: 'test',
        createdBy: 'admin',
      };
      
      jest.spyOn(prisma.globalPrompt, 'findUnique').mockResolvedValue({ id: 1 } as any);
      
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });
  
  // 更多测试用例...
});
```

#### 10.5.2 环境变量管理 🟢
**方案**：
```bash
# .env
DATABASE_URL="postgresql://user:password@localhost:5432/iac_incubator"
ENCRYPTION_KEY="your-256-bit-secret-key-here"
JWT_SECRET="your-jwt-secret"
JWT_EXPIRES_IN="7d"
REDIS_URL="redis://localhost:6379"
API_BASE_URL="http://localhost:3000"
```

```typescript
// config/configuration.ts
export default () => ({
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
});
```

---

## 十一、迭代优先级与时间规划

### 11.1 第一阶段：安全修复（1-2周）
**目标**：修复严重安全问题，确保系统基本安全

**任务清单**：
- [ ] 实现API Key加密存储
- [ ] 添加JWT认证中间件
- [ ] 实现基于角色的权限控制
- [ ] 移除前端localStorage缓存
- [ ] 添加环境变量管理
- [ ] 安全审计与渗透测试

**验收标准**：
- API Key不以明文形式存储
- 所有API接口都需要认证
- 关键操作需要管理员权限
- 通过基本的安全测试

### 11.2 第二阶段：功能完善（2-3周）
**目标**：修复数据一致性问题，完善核心功能

**任务清单**：
- [ ] 修复前后端字段不一致
- [ ] 重构前端逻辑，消除重复代码
- [ ] 完善审批流程，添加审批历史
- [ ] 实现版本历史管理
- [ ] 添加分页和搜索功能
- [ ] 添加Prompt测试功能

**验收标准**：
- 前后端字段完全一致
- 代码重复率降低到最低
- 审批流程完整可追溯
- 支持版本对比和回滚
- 列表支持分页和搜索

### 11.3 第三阶段：性能优化（1-2周）
**目标**：提升系统性能和用户体验

**任务清单**：
- [ ] 添加Redis缓存
- [ ] 数据库索引优化
- [ ] 前端性能优化
- [ ] 添加操作审计日志
- [ ] 集成Markdown编辑器
- [ ] 优化错误提示和用户引导

**验收标准**：
- 接口响应时间 < 200ms
- 缓存命中率 > 80%
- 用户体验流畅

### 11.4 第四阶段：质量提升（2周）
**目标**：提升代码质量和可维护性

**任务清单**：
- [ ] 添加单元测试（覆盖率 > 70%）
- [ ] 添加集成测试
- [ ] 代码规范检查（ESLint）
- [ ] 添加API文档（Swagger）
- [ ] 性能监控和告警
- [ ] 灰度发布和回滚机制

**验收标准**：
- 单元测试覆盖率 > 70%
- 所有关键路径有测试覆盖
- API文档完整准确

---

## 十二、总结

本项目是一个功能完整的AI Prompt管理系统，核心业务逻辑清晰，架构设计合理。但在安全性、数据一致性、功能完整性、性能优化等方面存在一些问题。

**核心优势**：
✅ 业务流程清晰，符合实际需求  
✅ 版本控制机制完善  
✅ 审批流程设计合理  
✅ 代码结构良好，易于理解  

**主要问题**：
❌ API Key明文存储，存在严重安全隐患  
❌ 缺少权限控制，任何用户都可以执行关键操作  
❌ 前后端字段不一致，数据模型不完整  
❌ 缺少审批历史和版本历史记录  
❌ 缺少分页、搜索、缓存等功能优化  

**建议行动**：
1. **立即处理**安全问题（API Key加密、权限控制）
2. **近期修复**数据一致性和逻辑混乱问题
3. **后续迭代**完善功能和优化性能
4. **持续改进**代码质量和测试覆盖

按照本文档的迭代建议执行，可以在保证系统安全性的前提下，逐步完善功能、提升性能、改善用户体验，最终建设成为一个安全、稳定、高效的AI Prompt管理平台。

---

**文档版本**：v1.0  
**最后更新**：2026-03-31  
**维护者**：IAC项目团队  
**审核人**：待审核
