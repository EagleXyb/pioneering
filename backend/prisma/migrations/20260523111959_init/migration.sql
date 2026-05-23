-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('system', 'user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "Feedback" AS ENUM ('none', 'like', 'dislike');

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(64) NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "nickname" VARCHAR(100),
    "avatar" VARCHAR(500),
    "email" VARCHAR(200),
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255),
    "wechat_openid" VARCHAR(100),
    "wechat_unionid" VARCHAR(100),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) DEFAULT '新对话',
    "model" VARCHAR(100) DEFAULT 'gpt-4o-mini',
    "model_config" JSONB,
    "system_prompt" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_id" VARCHAR(64),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" VARCHAR(64) NOT NULL,
    "session_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "parent_message_id" VARCHAR(64),
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "content_blocks" JSONB,
    "token_count" INTEGER,
    "feedback" "Feedback" NOT NULL DEFAULT 'none',
    "metadata" JSONB,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "original_name" VARCHAR(500) NOT NULL,
    "file_type" VARCHAR(50),
    "file_size" BIGINT,
    "file_path" VARCHAR(1000),
    "url" VARCHAR(1000),
    "thumbnail_url" VARCHAR(1000),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" BIGSERIAL NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "session_id" VARCHAR(64),
    "message_id" VARCHAR(64),
    "model" VARCHAR(100),
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost" DECIMAL(10,6),
    "created_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quotas" (
    "user_id" VARCHAR(64) NOT NULL,
    "total_tokens" BIGINT NOT NULL DEFAULT 1000000,
    "used_tokens" BIGINT NOT NULL DEFAULT 0,
    "daily_limit" BIGINT NOT NULL DEFAULT 100000,
    "daily_used" BIGINT NOT NULL DEFAULT 0,
    "reset_at" DATE,
    "updated_at" TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_quotas_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "idx_openid" ON "users"("wechat_openid");

-- CreateIndex
CREATE INDEX "idx_unionid" ON "users"("wechat_unionid");

-- CreateIndex
CREATE INDEX "idx_session_user" ON "chat_sessions"("user_id", "is_archived", "updated_at");

-- CreateIndex
CREATE INDEX "idx_message_session" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_parent" ON "chat_messages"("parent_message_id");

-- CreateIndex
CREATE INDEX "idx_file_user" ON "files"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_date" ON "token_usage"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_token_session" ON "token_usage"("session_id");

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
