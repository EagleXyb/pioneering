# 智能体后台管理端 - 信息架构与系统架构设计

> 版本：2.1.0 | 更新日期：2026-05-27  
> 技术栈：React + TypeScript + TDesign React（前端） / NestJS（后端） / 前后端分离  
> 设计参考：[TDesign React Starter Dashboard](https://tdesign.tencent.com/starter/react/dashboard/base)

---

## 一、功能模块清单（完整版）

### 原始模块（9个）
1. 用户管理
2. 系统设置
3. 模型管理
4. 数据管理
5. 智能体记忆
6. 账户管理（Token明细）
7. Prompt管理
8. 知识库/知识图谱
9. 其他（智能体工具调用明细、日志、API限流等）

### 补充模块（+6个）
10. **智能体管理/编排** - 核心功能，管理智能体的创建、配置、发布
11. **组件管理** - 管理感知、推理、记忆、行动等独立组件
12. **工作流编排** - 可视化编排智能体的感知→推理→记忆→行动流程
13. **仪表盘/概览** - 系统概览、数据统计、关键指标展示
14. **智能体测试/评估** - 测试智能体性能、评估回答质量
15. **审计日志** - 操作审计追踪（与运营日志区分）

---

## 二、信息架构（IA）

```
智能体后台管理端
├── 01. 仪表盘/概览
│   ├── 系统概览
│   ├── 使用统计
│   └── 关键指标
│
├── 02. 智能体管理（核心模块）
│   ├── 智能体列表
│   ├── 创建智能体
│   ├── 智能体配置
│   └── 智能体发布管理
│
├── 03. 组件管理
│   ├── 感知组件
│   ├── 推理组件
│   ├── 记忆组件
│   └── 行动组件
│
├── 04. 工作流编排
│   ├── 可视化编排器
│   ├── 流程模板
│   └── 版本管理
│
├── 05. 模型管理
│   ├── 模型配置
│   ├── 模型性能监控
│   └── 模型版本管理
│
├── 06. Prompt管理
│   ├── Prompt模板库
│   ├── 变量管理
│   └── 版本对比
│
├── 07. 知识库/知识图谱
│   ├── 知识库列表
│   ├── 知识图谱可视化
│   └── 知识导入/导出
│
├── 08. 智能体记忆
│   ├── 短期记忆
│   ├── 长期记忆
│   └── 记忆检索
│
├── 09. 数据管理
│   ├── 数据集管理
│   ├── 数据标注
│   └── 数据导出
│
├── 10. 监控与日志
│   ├── 操作日志
│   ├── 智能体工具调用明细
│   ├── API限流配置
│   ├── 性能监控
│   └── 审计日志
│
├── 11. 测试与评估
│   ├── 智能体测试
│   ├── 评估指标
│   └── 测试报告
│
├── 12. 账户与计费
│   ├── 账户概览
│   ├── Token明细
│   ├── 计费统计
│   └── 发票管理
│
├── 13. 用户管理
│   ├── 用户列表
│   ├── 角色权限
│   └── 用户组管理
│
└── 14. 系统设置
    ├── 系统配置
    ├── 通知设置
    ├── 安全设置
    └── 集成配置
```

---

## 三、侧边栏菜单结构

> 信息架构树是系统的「完整功能地图」，侧边栏菜单是从中提取的「导航入口」。
> 转换原则：合并相似模块到分组 → 操作类节点改为页面内按钮 → 同页内容用 Tab 切换。

### 3.1 菜单结构总览

```
侧边栏（232px）
├── 📊 仪表盘                          ← 独立页面（IA-01）
│
├── ▸ 智能体                           ← 分组（IA-02+03+04 合并）
│   ├── 智能体管理                      ← 侧边栏菜单项 → /agents
│   │   ├── Tab: 智能体列表             ← 页面内 Tab
│   │   ├── Btn: 创建智能体             ← 页面内按钮（非菜单！）
│   │   └── Btn: 发布管理               ← 页面内按钮（非菜单！）
│   ├── 组件管理                        ← 侧边栏菜单项 → /components
│   │   └── Tab: 感知 | 推理 | 记忆 | 行动  ← 页面内 Tab
│   └── 工作流编排                      ← 侧边栏菜单项 → /workflows
│       ├── 可视化编排器（主页面）
│       └── Tab: 流程模板 | 版本管理     ← 页面内 Tab
│
├── ▸ AI 能力                           ← 分组（IA-05+06+07+08 合并）
│   ├── 模型管理                        ← 侧边栏菜单项 → /models
│   │   └── Tab: 模型配置 | 性能监控 | 版本管理
│   ├── Prompt 管理                     ← 侧边栏菜单项 → /prompts
│   │   └── Tab: 模板库 | 变量管理 | 版本对比
│   ├── 知识库                          ← 侧边栏菜单项 → /knowledge
│   │   └── Tab: 知识库列表 | 知识图谱 | Btn: 导入/导出
│   └── 智能体记忆                      ← 侧边栏菜单项 → /memory
│       └── Tab: 短期记忆 | 长期记忆 | 记忆检索
│
├── ▸ 数据与分析                        ← 分组（IA-09+10+11 合并）
│   ├── 数据管理                        ← 侧边栏菜单项 → /data
│   │   └── Tab: 数据集 | 数据标注 | Btn: 导出
│   ├── 测试评估                        ← 侧边栏菜单项 → /tests
│   │   └── Tab: 智能体测试 | 评估指标 | 测试报告
│   └── 监控日志                        ← 侧边栏菜单项 → /monitor
│       └── Tab: 操作日志 | 工具调用明细 | API限流 | 性能监控 | 审计日志
│
├── ▸ 账户                              ← 分组（IA-12 独立）
│   └── 账户与计费                      ← 侧边栏菜单项 → /account
│       └── Tab: 账户概览 | Token明细 | 计费统计 | 发票管理
│
└── ▸ 系统                              ← 分组（IA-13+14 合并）
    ├── 用户管理                        ← 侧边栏菜单项 → /users
    │   └── Tab: 用户列表 | 角色权限 | 用户组
    └── 系统设置                        ← 侧边栏菜单项 → /settings
        └── Tab: 系统配置 | 通知设置 | 安全设置 | 集成配置
```

### 3.2 图例说明

| 标记 | 含义 | 示例 |
|------|------|------|
| `▸ 分组名` | 侧边栏 MenuGroup（不可点击，纯分组标签） | `▸ 智能体` |
| `菜单项` | 侧边栏 MenuItem（点击跳转路由） | `智能体管理 → /agents` |
| `Tab: xxx` | 页面内 TDesign Tabs 切换（不是菜单项） | `Tab: 短期记忆` |
| `Btn: xxx` | 页面内 Button 触发（不是菜单项） | `Btn: 创建智能体` |

### 3.3 关键转换规则

| 信息架构中的节点 | 侧边栏中的处理 | 原因 |
|-----------------|---------------|------|
| 一级模块（14个） | → 合并为 6 个 MenuGroup | 避免菜单过长（14个太多） |
| "创建智能体" | → 页面内 Primary Button | 是操作，不是页面 |
| "智能体配置" | → 列表页内 Drawer/弹窗 | 上下文相关，不适合独立菜单 |
| "发布管理" | → 列表页内 Button | 一个操作，不是独立页面 |
| "短期/长期记忆" | → 页面内 Tabs | 同一页面的不同视图 |
| "感知/推理/记忆/行动" | → 页面内 Tabs | 同一页面的不同 Tab |
| "知识导入/导出" | → 页面内 Button | 操作而非页面 |
| "仪表盘/概览" | → 独立菜单项（非分组） | 默认首页，无需嵌套 |

### 3.4 路由对应表

| 菜单路径 | 路由 | 页面组件 |
|---------|------|----------|
| 仪表盘 | `/dashboard` | `pages/Dashboard` |
| 智能体 > 智能体管理 | `/agents` | `pages/Agent` |
| 智能体 > 组件管理 | `/components` | `pages/Component` |
| 智能体 > 工作流编排 | `/workflows` | `pages/Workflow` |
| AI 能力 > 模型管理 | `/models` | `pages/Model` |
| AI 能力 > Prompt 管理 | `/prompts` | `pages/Prompt` |
| AI 能力 > 知识库 | `/knowledge` | `pages/Knowledge` |
| AI 能力 > 智能体记忆 | `/memory` | `pages/Memory` |
| 数据与分析 > 数据管理 | `/data` | `pages/Data` |
| 数据与分析 > 测试评估 | `/tests` | `pages/Test` |
| 数据与分析 > 监控日志 | `/monitor` | `pages/Monitor` |
| 账户 > 账户与计费 | `/account` | `pages/Account` |
| 系统 > 用户管理 | `/users` | `pages/User` |
| 系统 > 系统设置 | `/settings` | `pages/Settings` |

### 3.5 TDesign 菜单实现参考

```tsx
// 侧边栏菜单配置示例（router/menu.ts）
export const menuConfig = [
  {
    title: '仪表盘',
    icon: DashboardIcon,
    path: '/dashboard',
    single: true,                    // 单页面，无子菜单
  },
  {
    title: '智能体',
    icon: RobotIcon,
    children: [
      { title: '智能体管理', path: '/agents', icon: AppIcon },
      { title: '组件管理',   path: '/components', icon: ModuleIcon },
      { title: '工作流编排', path: '/workflows', icon: FlowIcon },
    ],
  },
  {
    title: 'AI 能力',
    icon: BrainIcon,
    children: [
      { title: '模型管理',     path: '/models', icon: ModelIcon },
      { title: 'Prompt 管理',  path: '/prompts', icon: EditIcon },
      { title: '知识库',       path: '/knowledge', icon: BookIcon },
      { title: '智能体记忆',   path: '/memory', icon: StorageIcon },
    ],
  },
  {
    title: '数据与分析',
    icon: ChartIcon,
    children: [
      { title: '数据管理', path: '/data', icon: FolderIcon },
      { title: '测试评估', path: '/tests', icon: CheckIcon },
      { title: '监控日志', path: '/monitor', icon: LogIcon },
    ],
  },
  {
    title: '账户',
    icon: WalletIcon,
    children: [
      { title: '账户与计费', path: '/account', icon: MoneyIcon },
    ],
  },
  {
    title: '系统',
    icon: SettingsIcon,
    children: [
      { title: '用户管理', path: '/users', icon: UserIcon },
      { title: '系统设置', path: '/settings', icon: GearIcon },
    ],
  },
];
```

---

## 四、系统架构设计

### 4.1 整体架构（前后端分离）

```
┌─────────────────────────────────────────────────────────┐
│                   Browser (浏览器)                       │
├─────────────────────────────────────────────────────────┤
│  Frontend (client/)                                      │
│  React 18+ / TypeScript 5+ / TDesign React / Vite       │
│  ├── Layout (SidebarLayout: 232px sidebar + content)    │
│  ├── Pages (14 modules)                                 │
│  ├── Router (React Router v6)                           │
│  └── Services (Axios + TanStack Query)                  │
├─────────────────────────────────────────────────────────┤
│                    REST API (JSON)                       │
├─────────────────────────────────────────────────────────┤
│  Backend (server/)                                       │
│  NestJS / TypeScript / Prisma ORM                       │
│  ├── Auth Module (JWT + Passport)                       │
│  ├── Agent Module                                       │
│  ├── Workflow Module                                    │
│  └── ... (14 modules)                                   │
├─────────────────────────────────────────────────────────┤
│              PostgreSQL / Redis                          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 前端架构

```
client/
├── src/
│   ├── components/       # 业务组件
│   ├── pages/           # 页面级组件
│   │   ├── Dashboard/   # 仪表盘
│   │   ├── Agent/       # 智能体管理
│   │   ├── Component/   # 组件管理
│   │   ├── Workflow/    # 工作流编排
│   │   ├── Model/       # 模型管理
│   │   ├── Prompt/      # Prompt管理
│   │   ├── Knowledge/   # 知识库
│   │   ├── Memory/      # 智能体记忆
│   │   ├── Data/        # 数据管理
│   │   ├── Monitor/     # 监控日志
│   │   ├── Test/        # 测试评估
│   │   ├── Account/     # 账户计费
│   │   ├── User/        # 用户管理
│   │   └── Settings/    # 系统设置
│   ├── layouts/         # 布局组件（SidebarLayout）
│   ├── router/          # 路由配置
│   ├── services/        # API请求封装（Axios）
│   ├── hooks/           # 自定义Hooks
│   ├── types/           # TypeScript类型定义
│   ├── styles/          # 全局样式 / TDesign主题覆盖
│   └── utils/           # 工具函数
├── vite.config.ts
└── package.json
```

### 4.3 后端架构

```
server/
├── src/
│   ├── modules/
│   │   ├── auth/            # 认证模块（JWT + Passport）
│   │   ├── agent/           # 智能体管理
│   │   ├── component/       # 组件管理
│   │   ├── workflow/        # 工作流编排
│   │   ├── model/           # 模型管理
│   │   ├── prompt/          # Prompt管理
│   │   ├── knowledge/       # 知识库/知识图谱
│   │   ├── memory/          # 智能体记忆
│   │   ├── data/            # 数据管理
│   │   ├── monitor/         # 监控与日志
│   │   ├── test/            # 测试评估
│   │   ├── account/         # 账户与计费
│   │   ├── user/            # 用户管理
│   │   └── settings/        # 系统设置
│   ├── common/              # 公共模块
│   │   ├── guards/          # 权限守卫
│   │   ├── interceptors/    # 拦截器（日志、响应格式化）
│   │   ├── decorators/      # 自定义装饰器
│   │   └── filters/         # 异常过滤器
│   ├── config/              # 配置管理
│   └── main.ts              # 应用入口
├── prisma/
│   └── schema.prisma        # 数据库模型
└── package.json
```

### 4.4 技术栈详情

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | React 18+ | UI 渲染 |
| **前端语言** | TypeScript 5+ | 类型安全 |
| **UI 组件库** | TDesign React | 企业级组件（对齐TDesign Starter） |
| **图标库** | tdesign-icons-react | 配套图标 |
| **状态管理** | TanStack Query | 服务端状态（请求缓存/去重/重试） |
| **路由** | React Router v6 | 前端路由 |
| **HTTP 客户端** | Axios | 请求封装（拦截器/统一错误处理） |
| **图表** | ECharts | Dashboard 图表渲染 |
| **工作流编排** | React Flow | 可视化节点编排 |
| **构建工具** | Vite | 开发/构建 |
| **后端框架** | NestJS | 后端服务 |
| **后端语言** | TypeScript 5+ | 类型安全 |
| **ORM** | Prisma | 数据库操作 |
| **数据库** | PostgreSQL | 主数据库 |
| **缓存** | Redis | 会话/限流/热点数据 |
| **API 文档** | Swagger | OpenAPI 自动生成 |
| **认证** | JWT + Passport | 用户认证与鉴权 |

### 4.5 核心页面交互流程

#### 智能体创建流程
```
1. 仪表盘 → 点击"创建智能体"
2. 选择模板（空白/预置模板）
3. 配置基本信息（名称、描述、图标）
4. 编排工作流（可视化编排器）
   - 添加感知组件
   - 添加推理组件
   - 添加记忆组件
   - 添加行动组件
   - 连接组件形成流程
5. 配置参数（模型、Prompt、知识库等）
6. 测试智能体
7. 发布智能体
```

#### 工作流编排流程
```
1. 进入工作流编排页面
2. 从左侧组件面板拖拽组件到画布
3. 连接组件形成流程
4. 配置每个组件的参数
5. 保存工作流
6. 测试工作流
7. 发布工作流
```

---

## 五、数据模型设计（简版）

### 5.1 智能体（Agent）
```typescript
interface Agent {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'enabled' | 'disabled';
  workflowId: string;  // 关联工作流
  config: AgentConfig;
  createdAt: string;
  updatedAt: string;
}
```

### 5.2 组件（Component）
```typescript
interface Component {
  id: string;
  name: string;
  type: 'perception' | 'reasoning' | 'memory' | 'action';
  description: string;
  config: Record<string, any>;
  version: string;
  createdAt: string;
}
```

### 5.3 工作流（Workflow）
```typescript
interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  version: string;
  createdAt: string;
}
```

---

## 六、权限设计

### 6.1 角色定义
- **超级管理员**：全部权限
- **管理员**：大部分权限，除了系统设置
- **开发者**：智能体管理、组件管理、工作流编排、测试
- **观察者**：只读权限

### 6.2 权限矩阵（简版）

| 功能模块 | 超级管理员 | 管理员 | 开发者 | 观察者 |
|---------|-----------|--------|--------|--------|
| 仪表盘 | ✓ | ✓ | ✓ | ✓ |
| 智能体管理 | ✓ | ✓ | ✓ | 只读 |
| 组件管理 | ✓ | ✓ | ✓ | 只读 |
| 工作流编排 | ✓ | ✓ | ✓ | 只读 |
| 模型管理 | ✓ | ✓ | ✗ | 只读 |
| Prompt管理 | ✓ | ✓ | ✓ | 只读 |
| 知识库 | ✓ | ✓ | ✓ | 只读 |
| 监控日志 | ✓ | ✓ | 部分 | 只读 |
| 账户计费 | ✓ | ✓ | ✗ | 只读 |
| 用户管理 | ✓ | ✗ | ✗ | ✗ |
| 系统设置 | ✓ | ✗ | ✗ | ✗ |

---

## 七、非功能需求

### 7.1 性能要求
- 页面加载时间：< 2秒
- 表格渲染（1000行）：< 1秒
- API响应时间：< 500ms
- 工作流编排画布（100个节点）：流畅操作

### 7.2 兼容性要求
- 浏览器：Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- 分辨率：最小 1280×720，推荐 1920×1080
- 移动端：响应式适配（优先桌面端）

### 7.3 安全要求
- 所有API调用需要身份验证
- 敏感数据加密存储
- 操作日志审计
- XSS/CSRF防护

---

*本文档可与 DESIGN.md 配合使用，DESIGN.md 提供视觉设计规范，本文档提供信息架构和系统架构设计。*
