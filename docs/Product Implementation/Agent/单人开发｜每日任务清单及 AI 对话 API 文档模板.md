# 单人开发｜每日任务清单及 AI 对话 API 文档模板

## 一、单人开发｜每日任务清单模板（直接复制即用）

> 适用：7 天迭代、单人敏捷、AI 对话 / 全栈项目通用
> 
> 

---

### 【今日待办】

1. 核心功能（必做）

- \[ \]

- \[ \]

- \[ \]

2. 次要功能 / 优化（可选）

- \[ \]

3. Bug \&amp; 异常兜底

- \[ \]

4. 文档 / 沉淀（5 分钟极简）

* [ ] 新增字段 / 接口记录

* [ ] 复用组件 / 工具类归档

### 【今日约束】

- 只做单线程：只前端 / 只后端，不交叉切换

- 优先 MVP：先可用，再美化、再优化

- 拒绝过度设计：不写未来才用得到的代码

### 【明日规划】

1. 

2. 

### 【当日复盘】

- 卡点问题：

- 解决方案：

- 可复用资产：

---

## 二、AI 对话项目｜极简 API 文档模板（直接填空对接）

> 统一规范：
> 
> 

- 基础前缀：`/api/v1`

- 响应统一：`\{code:number, msg:string, data:T\}`

- 鉴权：请求头 `Authorization: Bearer \{token\}`

- 流式：PC/APP = SSE｜小程序 = WebSocket

### 1\. 登录 / 注册（鉴权模块）

#### 注册

- 请求：`POST /api/v1/auth/register`

- 入参

```json
{
  "username": "string",
  "password": "string"
}
```

- 出参

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "userId": "string",
    "token": "string"
  }
}
```

#### 登录

- 请求：`POST /api/v1/auth/login`

- 入参：同注册

- 出参：同注册

---

### 2\. 会话管理

#### 新建会话

- 请求：`POST /api/v1/session/create`

- 入参

```json
{
  "userId": "string"
}
```

- 出参

```json
{
  "code": 200,
  "data": {
    "sessionId": "string",
    "title": "新对话",
    "createTime": "number"
  }
}
```

#### 获取会话列表

- 请求：`GET /api/v1/session/list?userId=xxx`

#### 清空当前会话

- 请求：`POST /api/v1/session/clear`

- 入参：`sessionId`

---

### 3\. 核心｜发送 AI 对话（流式）

#### 3\.1 SSE 接口（PC/APP）

- 请求：`GET /api/v1/chat/stream`

- 入参（query）

    - sessionId

    - question

    - userId

    - model?: string

- 流式分片返回（SSE data）

```json
{
  "content": "增量文本",
  "isEnd": false,
  "msgId": "xxx"
}
```

#### 3\.2 WebSocket 协议（小程序）

- 地址：`ws://domain/api/v1/chat/ws`

- 发送格式

```json
{
  "sessionId":"",
  "question":"",
  "userId":""
}
```

- 推送返回：同 SSE 结构

---

### 4\. 历史消息

- 请求：`GET /api/v1/message/history`

- 入参：`sessionId、page、pageSize`

- 出参：消息数组

---

### 三、全局统一状态码

```Plain Text
200 成功
400 参数错误/空输入
401 未登录/Token失效
403 内容违规/风控拦截
429 限流/请求频繁
500 服务异常
502 大模型调用失败
```

---

## 三、配套：单人全栈开发 固定开发顺序（永久复用）

1. 填好上面极简 API 文档 \+ 数据表结构

2. 前端优先：页面布局 → 组件 → 交互 → 假流式模拟

3. 后端次之：基础框架 → 鉴权 → 流式接口 → 大模型对接

4. 联调打通端到端

5. 数据落库 \+ 异常兜底

6. 小幅优化，交付当前版本

7. 进入下一个 7 天迭代

---

## 四、你接下来直接执行的最短行动路径

1. 复制「任务清单」到备忘录 / 笔记软件

2. 复制「API 文档模板」，根据你的字段简单补全

3. 开启迭代 1\-Day1：纯前端，完成聊天页面 \+ 假流式

4. 全程单线程，不前后端来回切

需要我把 **数据表结构（PostgreSQL）\+ 前后端 TS 通用类型定义** 也整理成一份可直接复制的极简文档吗？

> （注：文档部分内容可能由 AI 生成）
