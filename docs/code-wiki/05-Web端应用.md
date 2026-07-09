# Web 端应用

Web 前端应用位于 [apps/web](file:///d:/Administrator/Desktop/pioneering/apps/web)，基于 React 18 + TypeScript + Vite 构建，使用 TDesign React 组件库。

## 技术栈

- **框架**: React 18
- **构建工具**: Vite 6
- **语言**: TypeScript 5.6
- **UI 组件库**: TDesign React 1.11 + @tdesign-react/chat
- **图标**: tdesign-icons-react
- **状态管理**: Zustand 5
- **路由**: React Router DOM 7

## 目录结构

```
web/
├── src/
│   ├── api/                # API 客户端层
│   │   ├── client.ts       # HTTP 客户端基础配置
│   │   ├── auth-api.ts     # 认证 API
│   │   ├── chat.ts         # 聊天 API
│   │   ├── converter.ts    # 数据转换
│   │   ├── message.ts      # 消息 API
│   │   ├── session.ts      # 会话 API
│   │   └── types.ts        # API 类型定义
│   ├── components/
│   │   └── auth/
│   │       └── ProtectedRoute.tsx  # 路由保护组件
│   ├── hooks/
│   │   └── useAuth.ts      # 认证 Hook
│   ├── layout/             # 布局组件
│   │   ├── AppShell.css
│   │   ├── Sidebar/        # 侧边栏
│   │   └── TopNav/         # 顶部导航
│   ├── modes/              # 三种交互模式
│   │   ├── chat/           # 聊天模式
│   │   │   ├── ChatMode.tsx
│   │   │   ├── chat.css
│   │   │   ├── components/ # ChatInput/ChatMessageList 等
│   │   │   └── hooks/useChatSync.ts
│   │   ├── pro/            # Pro 模式（Agent）
│   │   │   ├── ProMode.tsx
│   │   │   ├── pro.css
│   │   │   ├── components/ # AnalysisInput/ProcessPanel 等
│   │   │   └── hooks/useAgentChat.ts
│   │   └── task/           # 任务模式
│   │       ├── TaskMode.tsx
│   │       ├── task.css
│   │       ├── components/ # TaskInput/TaskPipeline 等
│   │       └── hooks/useChatSync.ts
│   ├── pages/
│   │   └── auth/           # 认证页面
│   │       ├── AuthLayout.tsx
│   │       ├── Login.tsx
│   │       ├── Register.tsx
│   │       └── ForgotPassword.tsx
│   ├── store/              # 状态管理（Context 方式）
│   │   ├── appStore.ts
│   │   ├── conversationStore.ts
│   │   ├── themeContext.tsx
│   │   └── toastContext.tsx
│   ├── stores/             # Zustand stores
│   │   └── auth.ts         # 认证状态
│   ├── styles/
│   │   └── tokens.css      # 设计 Token
│   ├── types/
│   │   └── auth.d.ts       # 认证类型
│   ├── App.tsx             # 根组件（路由配置）
│   ├── main.tsx            # 入口
│   ├── index.css           # 全局样式
│   └── types.ts            # 全局类型
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 入口文件

### [main.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/main.tsx)

应用入口，配置全局 Provider：

```tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>       {/* 主题上下文 */}
      <ToastProvider>      {/* Toast 通知 */}
        <App />
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
)
```

全局样式加载顺序：
1. TDesign 基础样式 (`tdesign-react/es/style/index.css`)
2. TDesign Chat 样式 (`@tdesign-react/chat/es/style/index.js`)
3. 设计 Token (`styles/tokens.css`)
4. 全局 Reset (`index.css`)

## 三种交互模式

Web 端提供三种对话模式，满足不同使用场景：

### 1. 聊天模式 (Chat Mode)

[modes/chat/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/chat)

标准对话界面，类似 ChatGPT 的交互体验：

| 组件 | 文件 | 说明 |
|------|------|------|
| ChatMode | ChatMode.tsx | 模式容器 |
| ChatInput | components/ChatInput.tsx | 输入框 |
| ChatMessageList | components/ChatMessageList.tsx | 消息列表 |
| ChatMessageItem | components/ChatMessageItem.tsx | 单条消息 |
| useChatSync | hooks/useChatSync.ts | 聊天状态同步 Hook |

### 2. Pro 模式 (Pro Mode / Agent Mode)

[modes/pro/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/pro)

高级 Agent 模式，展示完整思考过程和工具调用：

| 组件 | 文件 | 说明 |
|------|------|------|
| ProMode | ProMode.tsx | 模式容器 |
| AnalysisInput | components/AnalysisInput.tsx | 分析输入区 |
| AnalysisLayout | components/AnalysisLayout.tsx | 分析布局 |
| AnalysisMessageList | components/AnalysisMessageList.tsx | 消息列表 |
| ProcessPanel | components/ProcessPanel.tsx | 处理过程面板（工具调用、思考链） |
| useAgentChat | hooks/useAgentChat.ts | Agent 对话 Hook（SSE 流式处理） |
| useChatSync | hooks/useChatSync.ts | 聊天同步 Hook |

**特性：**
- 流式接收 AG-UI 协议事件
- 实时展示思考过程（Thinking Block）
- 工具调用卡片展示
- 处理进度可视化

### 3. 任务模式 (Task Mode)

[modes/task/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task)

任务驱动模式，以流水线方式展示任务执行：

| 组件 | 文件 | 说明 |
|------|------|------|
| TaskMode | TaskMode.tsx | 模式容器 |
| TaskInput | components/TaskInput.tsx | 任务输入 |
| TaskMessageList | components/TaskMessageList.tsx | 任务消息列表 |
| TaskPipeline | components/TaskPipeline.tsx | 任务流水线视图 |
| useChatSync | hooks/useChatSync.ts | 任务同步 Hook |

## 布局结构

### AppShell

整体应用外壳布局，包含侧边栏和主内容区。

### 侧边栏 [layout/Sidebar/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/layout/Sidebar)

- 会话历史列表
- 模式切换入口
- 新建会话按钮

### 顶部导航 [layout/TopNav/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/layout/TopNav)

- 用户信息
- 设置入口
- 主题切换

## 认证系统

### 认证页面 [pages/auth/](file:///d:/Administrator/Desktop/pioneering/apps/web/src/pages/auth)

| 页面 | 文件 | 说明 |
|------|------|------|
| Login | Login.tsx | 登录页 |
| Register | Register.tsx | 注册页 |
| ForgotPassword | ForgotPassword.tsx | 忘记密码 |
| AuthLayout | AuthLayout.tsx | 认证页布局 |

### 路由保护

[ProtectedRoute.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/components/auth/ProtectedRoute.tsx) 组件：
- 检查用户是否已认证（通过 useAuth Hook）
- 未认证重定向到登录页
- 已认证显示子路由

### 认证状态

[stores/auth.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/stores/auth.ts) 使用 Zustand 管理认证状态：
- Token 存储（localStorage）
- 用户信息
- 登录/登出动作
- Token 刷新逻辑

### useAuth Hook

[hooks/useAuth.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/hooks/useAuth.ts) 提供认证相关方法：
- `login(credentials)` - 登录
- `register(data)` - 注册
- `logout()` - 登出
- `isAuthenticated` - 是否已认证
- `user` - 当前用户信息

## API 客户端层

### HTTP 客户端 [api/client.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/api/client.ts)

基于 fetch/axios 的 HTTP 客户端，配置：
- baseURL: 后端 API 地址（默认 http://localhost:9000）
- 请求拦截器：自动附加 JWT Token
- 响应拦截器：统一错误处理、Token 过期刷新
- SSE 支持：用于 Agent 流式响应

### API 模块

| 模块 | 文件 | 说明 |
|------|------|------|
| auth-api | api/auth-api.ts | 登录、注册、Token 刷新 |
| chat | api/chat.ts | 聊天消息、会话管理 |
| message | api/message.ts | 消息 CRUD |
| session | api/session.ts | 会话管理 |
| converter | api/converter.ts | 数据格式转换 |

### 流式响应处理

Pro 模式通过 SSE (Server-Sent Events) 接收后端 AG-UI 协议事件：

```
EventSource 连接后端 /api/v1/agent/stream
    ↓
接收 AG-UI 事件流：
  ├─ THINKING_START       → 开始展示思考块
  ├─ THINKING_TEXT_*      → 追加思考内容
  ├─ THINKING_END         → 结束思考块
  ├─ TOOL_CALL_START      → 展示工具调用卡片
  ├─ TOOL_CALL_RESULT     → 更新工具结果
  ├─ TEXT_MESSAGE_CONTENT → 追加响应文本（打字机效果）
  ├─ TEXT_MESSAGE_END     → 响应结束
  └─ RUN_ERROR            → 显示错误
```

## 状态管理

### Zustand Stores

[stores/auth.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/stores/auth.ts) - 认证状态

### Context 状态

| Context | 文件 | 说明 |
|---------|------|------|
| ThemeContext | store/themeContext.tsx | 主题切换（亮色/暗色） |
| ToastContext | store/toastContext.tsx | 全局 Toast 通知 |

### 传统 Store

| Store | 文件 | 说明 |
|-------|------|------|
| appStore | store/appStore.ts | 应用全局状态 |
| conversationStore | store/conversationStore.ts | 会话状态 |

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式（端口 5173）
npm run dev

# 类型检查 + 构建
npm run build

# 预览构建产物
npm run preview
```

## 开发配置

### Vite 配置 [vite.config.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/vite.config.ts)

- React 插件支持
- API 代理配置（可选，用于开发期跨域）
- 路径别名

### TypeScript 配置

多 tsconfig 配置：
- `tsconfig.json`: 根配置
- `tsconfig.app.json`: 应用代码配置

## 与后端通信

Web 端通过 HTTP/SSE 与后端通信：

| 类型 | 端点 | 说明 |
|------|------|------|
| REST | `POST /api/v1/auth/login` | 登录 |
| REST | `GET/POST /api/v1/chat/*` | 聊天消息 |
| SSE | `GET /api/v1/agent/stream` | Agent 流式对话 |
| REST | `POST /api/v1/upload` | 文件上传 |

**默认后端地址**: `http://localhost:9000`（可通过配置或环境变量修改）
