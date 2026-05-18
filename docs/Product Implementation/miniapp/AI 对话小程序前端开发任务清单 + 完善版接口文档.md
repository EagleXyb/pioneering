# AI 对话小程序前端开发任务清单 \+ 完善版接口文档

## 一、细化版每日任务清单（适配小程序开发）

### Day 1：前端骨架 \+ 交互全落地（纯前端，假数据）

#### 【今日待办】

1. 核心功能（必做）

* [ ] 完成整体页面布局：顶部导航栏（会话标题、返回按钮）、聊天内容区（消息列表容器）、底部输入栏（输入框 \+ 发送按钮 \+ 加载状态）

* [ ] 封装核心组件：

    - 消息气泡组件（区分用户 / AI、支持自定义样式）

    - 输入框组件（支持多行输入、高度自适应）

    - 发送按钮组件（禁用态 / 正常态切换）

    - 加载状态组件（AI 思考中动效）

* [ ] 实现全量交互逻辑：

    - 空内容拦截（输入为空时禁用发送按钮）

    - 发送按钮禁用态（输入为空 / 正在发送时禁用）

    - 键盘交互：Enter 发送、Shift\+Enter 换行（适配小程序输入框键盘事件）

    - 自动滚动：发送消息 / 接收消息后滚动到最新消息

    - 禁止重复提交：发送中锁定提交逻辑

    - 模拟假流式输出：本地定时器分片拼接文字，复刻大模型打字效果

2. 次要功能 / 优化（可选）

* [ ] 适配小程序不同机型的布局适配（刘海屏、全面屏）

* [ ] 消息气泡长按菜单（暂存 / 复制，仅 UI 层）

3. Bug \&amp; 异常兜底

* [ ] 输入框快速输入 / 删除时的状态同步问题

* [ ] 滚动逻辑边界处理（无消息时 / 消息过多时）

4. 文档 / 沉淀（5 分钟极简）

* [ ] 记录核心组件的 props 定义

* [ ] 记录交互逻辑的关键判断条件

#### 【今日约束】

- 只做纯前端开发，不涉及任何后端接口对接

- 优先实现可用的交互，样式仅做基础适配，不做过度美化

- 所有假数据 / 假流式逻辑写在本地，不依赖外部资源

#### 【明日规划】

1. 完善消息状态管理（加载中 / 成功 / 错误 / 停止生成）

2. 接入 Markdown 渲染，处理富文本展示

3. 封装全局工具函数，实现本地缓存逻辑

#### 【当日复盘】

- 卡点问题：

- 解决方案：

- 可复用资产：

### Day 2：前端状态完善 \+ 富文本基础渲染

#### 【今日待办】

1. 核心功能（必做）

* [ ] 完善消息状态管理：

    - 为每条消息添加状态标识（loading/success/error/stop）

    - 实现状态切换 UI（加载中动效、错误提示、停止生成按钮）

* [ ] 富文本渲染：

    - 接入小程序版 Markdown 渲染库（如 mp\-markdown）

    - 实现代码块基础样式（背景色、字体、换行、高亮）

    - 适配普通文本 / Markdown 文本的统一渲染

* [ ] 封装全局工具函数：

    - 消息格式化（统一用户 / AI 消息结构）

    - 文本截断（长消息预览、超出指定长度省略）

    - 特殊字符处理（转义小程序敏感字符、emoji 适配）

* [ ] 本地缓存：

    - 输入框草稿临时存储（小程序本地存储 wx\.setStorageSync）

    - 缓存失效 / 清空逻辑（退出页面 / 切换会话时可选清空）

2. 次要功能 / 优化（可选）

* [ ] 错误状态下的重试按钮

* [ ] Markdown 表格 / 列表基础适配

3. Bug \&amp; 异常兜底

* [ ] Markdown 渲染异常（非法语法、超长文本）

* [ ] 本地缓存读写失败的降级处理

4. 文档 / 沉淀（5 分钟极简）

* [ ] 记录 Markdown 渲染适配的边界情况

* [ ] 记录本地缓存的 key 命名规范

#### 【今日约束】

- 仍保持纯前端开发，不对接真实接口

- 工具函数需考虑复用性，为后续对接后端做铺垫

- 优先保证核心功能稳定，样式优化仅做基础达标

#### 【明日规划】

1. 对接真实后端接口（登录 / 注册、会话管理、流式消息）

2. 联调前后端交互逻辑，替换假数据为真实接口返回

#### 【当日复盘】

- 卡点问题：

- 解决方案：

- 可复用资产：

## 二、完善版 AI 对话小程序 API 文档（适配核心功能）

### 统一规范

- 基础前缀：`/api/v1`

- 响应统一格式：`\{code:number, msg:string, data:T\}`

- 鉴权：请求头 `Authorization: Bearer \{token\}`（小程序需在请求头中携带）

- 流式协议：小程序专属 WebSocket（替代 SSE）

- 小程序请求适配：所有 POST 请求使用 `application/json` 格式，GET 请求参数拼接到 query

### 1\. 登录 / 注册（鉴权模块）

#### 注册

- 请求：`POST /api/v1/auth/register`

- 入参（JSON）

```json
{
  "username": "string（小程序端建议用手机号/微信昵称）",
  "password": "string（若微信授权可省略，传openId）",
  "openId": "string（小程序微信授权唯一标识，可选）"
}
```

- 出参

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "userId": "string（用户唯一标识）",
    "token": "string（鉴权令牌，小程序需缓存到本地）"
  }
}
```

#### 登录

- 请求：`POST /api/v1/auth/login`

- 入参（JSON）

```json
{
  "username": "string",
  "password": "string",
  "openId": "string（可选，微信快捷登录）"
}
```

- 出参：同注册

- 特殊说明：小程序建议优先走微信授权登录，通过 openId 免密登录，减少用户输入

### 2\. 新建会话

- 请求：`POST /api/v1/session/create`

- 入参（JSON）

```json
{
  "userId": "string（当前登录用户ID）",
  "title": "string（可选，自定义会话标题，不传默认“新对话”）"
}
```

- 出参

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "sessionId": "string（会话唯一标识，小程序需缓存）",
    "title": "string（会话标题）",
    "createTime": "number（时间戳，单位ms）"
  }
}
```

### 3\. 核心｜发送 AI 对话（小程序专属 WebSocket）

- 地址：`ws://\{domain\}/api/v1/chat/ws`（生产环境建议用 wss）

- 连接前鉴权：WebSocket 握手时携带 token，格式：`ws://\{domain\}/api/v1/chat/ws?token=\{token\}`

- 发送格式（JSON）

```json
{
  "sessionId": "string（当前会话ID）",
  "question": "string（用户输入的问题，不能为空）",
  "userId": "string（当前登录用户ID）",
  "model": "string（可选，指定大模型版本，如gpt-3.5-turbo）"
}
```

- 推送返回（流式分片，每次返回增量内容）

```json
{
  "content": "string（增量文本，如“你好”→“你好，有什么”→“你好，有什么可以帮你”）",
  "isEnd": "boolean（是否结束，true表示回复完成）",
  "msgId": "string（消息唯一标识）",
  "status": "string（可选，loading/success/error，标识当前消息状态）"
}
```

- 异常推送（出错时返回）

```json
{
  "content": "string（错误提示，如“请求频繁，请稍后再试”）",
  "isEnd": true,
  "msgId": "string",
  "status": "error",
  "errorCode": "number（对应全局状态码，如429/500）"
}
```

### 4\. 获取历史消息

- 请求：`GET /api/v1/message/history`

- 入参（query）

    - sessionId：string（必填，要查询的会话 ID）

    - page：number（必填，页码，从 1 开始）

    - pageSize：number（必填，每页条数，建议 10/20）

    - userId：string（必填，当前用户 ID，防止越权）

- 出参

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "list": [
      {
        "msgId": "string（消息ID）",
        "sessionId": "string（会话ID）",
        "role": "string（角色，user/assistant）",
        "content": "string（消息内容，Markdown格式）",
        "createTime": "number（时间戳）",
        "status": "string（消息状态，success/error）"
      }
    ],
    "total": "number（总消息数）",
    "page": "number（当前页码）",
    "pageSize": "number（每页条数）"
  }
}
```

### 5\. 清空会话

- 请求：`POST /api/v1/session/clear`

- 入参（JSON）

```json
{
  "sessionId": "string（要清空的会话ID）",
  "userId": "string（当前用户ID，防止越权）"
}
```

- 出参

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "isClear": true
  }
}
```

### 全局统一状态码（补充小程序适配说明）

|状态码|含义|小程序前端处理建议|
|---|---|---|
|200|成功|正常渲染数据 / 完成交互|
|400|参数错误 / 空输入|提示用户检查输入内容，清空输入框禁用态|
|401|未登录 / Token 失效|跳转登录页，清空本地缓存的 token|
|403|内容违规 / 风控拦截|提示用户 “内容违规，请修改后重试”|
|429|限流 / 请求频繁|禁用发送按钮 N 秒，提示 “请求频繁，请稍后再试”|
|500|服务异常|展示错误提示，提供 “重试” 按钮|
|502|大模型调用失败|提示 “AI 服务暂时不可用”，引导用户稍后重试|

## 三、小程序前端开发关键适配点（补充）

1. WebSocket 连接管理：

    - 小程序需在 `onShow` 时重连 WebSocket，`onHide` 时断开连接

    - 处理断网重连逻辑，展示重连提示

2. 本地缓存规范：

    - token 缓存 key：`ai\_chat\_token\_\{userId\}`

    - 输入框草稿缓存 key：`ai\_chat\_draft\_\{sessionId\}`

    - 会话列表缓存 key：`ai\_chat\_session\_list\_\{userId\}`

3. 假流式模拟核心代码（Day1 可用）：

```javascript
// 小程序端假流式输出模拟
mockStreamReply(question, callback) {
  // 模拟AI回复文本
  const mockReply = "您好！很高兴为您解答问题，我是基于大模型的智能助手，有任何问题都可以问我。";
  let index = 0;
  // 定时器分片返回
  const timer = setInterval(() => {
    if (index >= mockReply.length) {
      clearInterval(timer);
      // 结束标识
      callback({ content: "", isEnd: true, msgId: Date.now().toString() });
      return;
    }
    // 每次取1-3个字符，模拟随机打字速度
    const step = Math.floor(Math.random() * 3) + 1;
    const content = mockReply.substring(index, index + step);
    index += step;
    // 回调返回增量内容
    callback({
      content,
      isEnd: false,
      msgId: Date.now().toString(),
      status: "loading"
    });
  }, 100);
}
```

4. 输入框键盘交互（小程序适配）：

```javascript
// 输入框键盘事件处理
handleInputKeyDown(e) {
  const { keyCode, shiftKey } = e.detail;
  // Enter键（keyCode=13）
  if (keyCode === 13) {
    if (shiftKey) {
      // Shift+Enter 换行
      this.setData({
        inputValue: this.data.inputValue + "\n"
      });
    } else {
      // Enter 发送
      if (this.data.inputValue.trim()) {
        this.sendMsg();
      }
    }
  }
}
```

## 四、前端交付标准

### Day 1 交付物

- 聊天页面完整布局，适配小程序各机型

- 所有交互逻辑正常（空内容拦截、发送禁用、自动滚动、重复提交禁止）

- 假流式输出效果与真实大模型一致，打字速度自然

- 页面可独立运行，无报错，无需后端支持即可演示

### Day 2 交付物

- 消息状态（加载中 / 成功 / 错误 / 停止）完整展示

- Markdown 渲染正常（含代码块样式）

- 全局工具函数封装完成，无重复代码

- 输入框草稿本地缓存生效，切换会话 / 退出页面可恢复

- 前端代码可直接对接真实接口，仅需替换假数据逻辑

> （注：文档部分内容可能由 AI 生成）
