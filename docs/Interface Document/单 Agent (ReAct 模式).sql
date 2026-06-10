-- ============================================================
-- Phase 1: 单 Agent 闭环与基础可观测性 (PostgreSQL 版)
-- ============================================================

-- 1. 用户表
CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    nickname VARCHAR(100),
    avatar VARCHAR(500),
    email VARCHAR(200),
    phone VARCHAR(20),
    password_hash VARCHAR(255),  -- Web 端密码
    wechat_openid VARCHAR(100),  -- 小程序 openid
    wechat_unionid VARCHAR(100), -- 微信 unionid（多端打通）
    status SMALLINT DEFAULT 1,   -- 1=正常, 0=禁用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.status IS '1=正常, 0=禁用';
CREATE INDEX idx_users_openid ON users(wechat_openid);
CREATE INDEX idx_users_unionid ON users(wechat_unionid);


-- 2. Token 刷新表
CREATE TABLE refresh_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    token VARCHAR(500) UNIQUE NOT NULL,     -- refresh token 值
    device_info VARCHAR(200),               -- 设备信息（用于多设备管理）
    expires_at TIMESTAMP NOT NULL,          -- 过期时间
    revoked BOOLEAN DEFAULT FALSE,          -- 是否已撤销
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE refresh_tokens IS 'Token 刷新表';
COMMENT ON COLUMN refresh_tokens.token IS 'refresh token 值';
COMMENT ON COLUMN refresh_tokens.device_info IS '设备信息（用于多设备管理）';
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);


-- 3. 会话表 (整合基础对话与 Agent 模式字段)
CREATE TABLE chat_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) DEFAULT '新对话',
    model VARCHAR(100) DEFAULT 'gpt-4o-mini',
    model_config JSONB,            -- 温度、最大 token 等模型配置
    system_prompt TEXT,
    message_count INT DEFAULT 0,
    last_message_id VARCHAR(64),
    is_archived BOOLEAN DEFAULT FALSE,
    agent_mode VARCHAR(50),        -- Agent 模式标识 (如: react_agent, rag_agent。NULL 表示普通对话)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE chat_sessions IS 'AI 对话会话表';
COMMENT ON COLUMN chat_sessions.title IS '会话标题 (可由 LLM 自动生成)';
COMMENT ON COLUMN chat_sessions.model_config IS '模型配置 (如 temperature, top_p, model_name)';
COMMENT ON COLUMN chat_sessions.agent_mode IS 'Agent 模式标识 (如: react_agent, rag_agent。NULL 表示普通单轮/多轮对话)';
CREATE INDEX idx_sessions_user ON chat_sessions(user_id, is_archived, updated_at);
CREATE INDEX idx_sessions_agent_mode ON chat_sessions(agent_mode);


-- 4. 消息主干表 (整合基础消息与 LLM 可观测性/反馈字段)
CREATE TABLE chat_messages (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    parent_message_id VARCHAR(64),  -- 父消息（用于分支）
    role VARCHAR(20) NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    content_blocks JSONB,           -- 多模态内容块 / Agent 执行步骤轨迹 (前端 UI 渲染用)
    token_count INT,
    feedback VARCHAR(20) DEFAULT 'none' CHECK (feedback IN ('none', 'like', 'dislike')),
    metadata JSONB,                 -- 引用来源、代码语言、Trace ID 等扩展元数据
    
    -- LLM 基础可观测性指标
    prompt_tokens INT,
    completion_tokens INT,
    latency_ms INT,                 -- LLM 接口响应总延迟 (毫秒)
    
    -- 用户反馈闭环
    user_rating SMALLINT,           -- 用户评分 (1-5星，或 1=赞, 0=踩)
    user_feedback TEXT,             -- 用户具体反馈/纠错文本
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_messages_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    CONSTRAINT fk_messages_parent FOREIGN KEY (parent_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
);

COMMENT ON TABLE chat_messages IS 'AI 对话消息主干表';
COMMENT ON COLUMN chat_messages.parent_message_id IS '父消息ID (用于构建对话树/分支)';
COMMENT ON COLUMN chat_messages.content_blocks IS '核心：Agent 执行步骤轨迹或多模态内容块';
COMMENT ON COLUMN chat_messages.prompt_tokens IS '本次请求消耗的 Prompt Token 数';
COMMENT ON COLUMN chat_messages.completion_tokens IS '本次请求消耗的 Completion Token 数';
COMMENT ON COLUMN chat_messages.latency_ms IS 'LLM 接口响应总延迟 (毫秒)';
COMMENT ON COLUMN chat_messages.user_rating IS '用户评分 (1-5星，或 1=赞, 0=踩)';
CREATE INDEX idx_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX idx_messages_parent ON chat_messages(parent_message_id);
CREATE INDEX idx_messages_role ON chat_messages(role);
CREATE INDEX idx_messages_latency ON chat_messages(latency_ms);
CREATE INDEX idx_messages_rating ON chat_messages(user_rating);


-- 5. Agent 工具执行明细表
CREATE TABLE agent_tool_executions (
    id VARCHAR(64) PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    
    -- 工具基本信息
    tool_name VARCHAR(100) NOT NULL,
    tool_call_id VARCHAR(100),      -- LLM 生成的 tool_call_id (用于上下文严格对齐)
    
    -- 执行数据 (核心：分离大文本)
    input_params JSONB,
    output_result TEXT,             -- 工具执行原始结果 (可能很大，如网页源码)
    output_summary TEXT,            -- 工具结果摘要 (供 LLM 阅读或前端展示)
    
    -- 状态与性能追踪
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'error', 'timeout', 'canceled')),
    error_message TEXT,
    
    start_time TIMESTAMP(3),
    end_time TIMESTAMP(3),
    duration_ms INT GENERATED ALWAYS AS (
        CASE 
            WHEN start_time IS NOT NULL AND end_time IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (end_time - start_time)) * 1000 
            ELSE NULL 
        END
    ) STORED,
    
    -- 审计与扩展
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_exec_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    CONSTRAINT fk_exec_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

COMMENT ON TABLE agent_tool_executions IS 'Agent 工具执行明细表 (存储大 payload 和运行状态)';
COMMENT ON COLUMN agent_tool_executions.duration_ms IS '执行耗时(毫秒)，自动计算';
CREATE INDEX idx_tool_exec_message ON agent_tool_executions(message_id);
CREATE INDEX idx_tool_exec_session_tool ON agent_tool_executions(session_id, tool_name);
CREATE INDEX idx_tool_exec_status ON agent_tool_executions(status);


-- 6. 文件表
CREATE TABLE files (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size BIGINT,
    file_path VARCHAR(1000),
    url VARCHAR(1000),
    thumbnail_url VARCHAR(1000),
    status SMALLINT DEFAULT 1,       -- 1=正常, 0=删除
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_files_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE files IS '文件表';
COMMENT ON COLUMN files.status IS '1=正常, 0=删除';
CREATE INDEX idx_files_user ON files(user_id);


-- 7. Token 使用记录表
CREATE TABLE token_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64),
    message_id VARCHAR(64),
    model VARCHAR(100),
    prompt_tokens INT,
    completion_tokens INT,
    total_tokens INT,
    cost DECIMAL(10, 6),            -- 花费（元）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_token_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE token_usage IS 'Token 使用记录表';
COMMENT ON COLUMN token_usage.cost IS '花费（元）';
CREATE INDEX idx_token_usage_user_date ON token_usage(user_id, created_at);
CREATE INDEX idx_token_usage_session ON token_usage(session_id);


-- 8. 配额表
CREATE TABLE user_quotas (
    user_id VARCHAR(64) PRIMARY KEY,
    total_tokens BIGINT DEFAULT 1000000,    -- 总配额
    used_tokens BIGINT DEFAULT 0,           -- 已使用
    daily_limit BIGINT DEFAULT 100000,      -- 每日限制
    daily_used BIGINT DEFAULT 0,            -- 今日已用
    reset_at DATE,                          -- 重置日期
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_quotas_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE user_quotas IS '用户配额表';