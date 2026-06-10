-- 用户表
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
    status TINYINT DEFAULT 1,    -- 1=正常, 0=禁用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_openid (wechat_openid),
    INDEX idx_unionid (wechat_unionid)
);

-- Token 刷新表（新增）
CREATE TABLE refresh_tokens (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    token VARCHAR(500) UNIQUE NOT NULL,     -- refresh token 值
    device_info VARCHAR(200),               -- 设备信息（用于多设备管理）
    expires_at TIMESTAMP NOT NULL,          -- 过期时间
    revoked BOOLEAN DEFAULT FALSE,          -- 是否已撤销
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_token (token),
    INDEX idx_expires (expires_at)
);

-- 会话表
CREATE TABLE chat_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    title VARCHAR(200) DEFAULT '新对话',
    model VARCHAR(100) DEFAULT 'gpt-4o-mini',
    model_config JSON,           -- 温度、最大 token 等
    system_prompt TEXT,
    message_count INT DEFAULT 0,
    last_message_id VARCHAR(64),
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id, is_archived, updated_at)
);

-- 消息表
CREATE TABLE chat_messages (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    parent_message_id VARCHAR(64),  -- 父消息（用于分支）
    role ENUM('system', 'user', 'assistant', 'tool') NOT NULL,
    content TEXT NOT NULL,
    content_blocks JSON,            -- 多模态内容块
    token_count INT,
    feedback ENUM('none', 'like', 'dislike') DEFAULT 'none',
    metadata JSON,                  -- 引用来源、代码语言等
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
    INDEX idx_session (session_id, created_at),
    INDEX idx_parent (parent_message_id)
);

-- 文件表
CREATE TABLE files (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(50),
    file_size BIGINT,
    file_path VARCHAR(1000),
    url VARCHAR(1000),
    thumbnail_url VARCHAR(1000),
    status TINYINT DEFAULT 1,       -- 1=正常, 0=删除
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id)
);

-- Token 使用记录表
CREATE TABLE token_usage (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64),
    message_id VARCHAR(64),
    model VARCHAR(100),
    prompt_tokens INT,
    completion_tokens INT,
    total_tokens INT,
    cost DECIMAL(10, 6),            -- 花费（元）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, created_at),
    INDEX idx_session (session_id)
);

-- 配额表
CREATE TABLE user_quotas (
    user_id VARCHAR(64) PRIMARY KEY,
    total_tokens BIGINT DEFAULT 1000000,    -- 总配额
    used_tokens BIGINT DEFAULT 0,           -- 已使用
    daily_limit BIGINT DEFAULT 100000,      -- 每日限制
    daily_used BIGINT DEFAULT 0,            -- 今日已用
    reset_at DATE,                          -- 重置日期
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);