-- =====================================================
-- PostgreSQL 数据库表结构导出
-- 数据库: iac_incubator
-- Schema: public
-- 导出时间: 2025-01-20
-- =====================================================

-- =====================================================
-- 表 1: agent_log（代理日志）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."agent_log_id_seq";

CREATE TABLE "public"."agent_log" (
  "id" int4 NOT NULL DEFAULT nextval('agent_log_id_seq'::regclass),
  "session_id" varchar(64) NOT NULL,
  "log_type" varchar(32) NOT NULL,
  "input" text,
  "output" text,
  "cost_time" int4,
  "create_time" timestamp(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_log_pkey" PRIMARY KEY ("id")
);

-- =====================================================
-- 表 2: AIConfig（AI配置）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."\"AIConfig_id_seq\"";

CREATE TABLE "public"."AIConfig" (
  "id" int4 NOT NULL DEFAULT nextval('"AIConfig_id_seq"'::regclass),
  "apiKey" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt" text NOT NULL,
  "lastTestInput" text,
  "lastTestResult" text,
  "lastTestTime" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "AIConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIConfig_provider_model_key" ON "public"."AIConfig" USING btree (
  "provider" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST,
  "model" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- =====================================================
-- 表 3: creative_list（创意列表）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."creative_list_id_seq";

CREATE TABLE "public"."creative_list" (
  "id" int4 NOT NULL DEFAULT nextval('creative_list_id_seq'::regclass),
  "session_id" varchar(64) NOT NULL,
  "content" text NOT NULL,
  "sort" int4 DEFAULT 1,
  "create_time" timestamp(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_list_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_creative_session" ON "public"."creative_list" USING btree (
  "session_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

ALTER TABLE "public"."creative_list" ADD CONSTRAINT "creative_list_session_id_fkey" 
  FOREIGN KEY ("session_id") REFERENCES "public"."user_session" ("session_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- =====================================================
-- 表 4: demand_anchor（需求锚点）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."demand_anchor_id_seq";

CREATE TABLE "public"."demand_anchor" (
  "id" int4 NOT NULL DEFAULT nextval('demand_anchor_id_seq'::regclass),
  "session_id" varchar(64) NOT NULL,
  "target" text NOT NULL,
  "user_group" text NOT NULL,
  "constraint_condition" text NOT NULL,
  "innovation_type" varchar(32) NOT NULL,
  CONSTRAINT "demand_anchor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demand_anchor_session_id_key" ON "public"."demand_anchor" USING btree (
  "session_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

ALTER TABLE "public"."demand_anchor" ADD CONSTRAINT "demand_anchor_session_id_fkey" 
  FOREIGN KEY ("session_id") REFERENCES "public"."user_session" ("session_id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- =====================================================
-- 表 5: global_prompt（全局提示词模板）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."global_prompt_id_seq";

CREATE TABLE "public"."global_prompt" (
  "id" int4 NOT NULL DEFAULT nextval('global_prompt_id_seq'::regclass),
  "name" text NOT NULL,
  "templateContent" text NOT NULL,
  "version" int4 NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'offline'::text,
  "approvalStatus" text NOT NULL DEFAULT 'pending'::text,
  "createdBy" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "global_prompt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_prompt_name_key" ON "public"."global_prompt" USING btree (
  "name" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- =====================================================
-- 表 6: innovation_case（创新案例）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."innovation_case_id_seq";

CREATE TABLE "public"."innovation_case" (
  "id" int4 NOT NULL DEFAULT nextval('innovation_case_id_seq'::regclass),
  "scene_type" varchar(32) NOT NULL,
  "case_title" varchar(128) NOT NULL,
  "core_demand" text NOT NULL,
  "core_idea" text NOT NULL,
  "create_time" timestamp(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "innovation_case_pkey" PRIMARY KEY ("id")
);

COMMENT ON COLUMN "public"."innovation_case"."scene_type" IS '场景：product/marketing/service';
COMMENT ON COLUMN "public"."innovation_case"."core_demand" IS '核心需求';
COMMENT ON COLUMN "public"."innovation_case"."core_idea" IS '核心创意';

-- =====================================================
-- 表 7: innovation_method（创新方法）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."innovation_method_id_seq";

CREATE TABLE "public"."innovation_method" (
  "id" int4 NOT NULL DEFAULT nextval('innovation_method_id_seq'::regclass),
  "method_code" varchar(32) NOT NULL,
  "method_name" varchar(64) NOT NULL,
  "apply_scene" text NOT NULL,
  "step_list" jsonb NOT NULL,
  "prompt_template" text NOT NULL,
  "create_time" timestamp(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "innovation_method_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "innovation_method_method_code_key" ON "public"."innovation_method" USING btree (
  "method_code" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

COMMENT ON COLUMN "public"."innovation_method"."method_code" IS '唯一编码：5w2h/scamper/brainstorm';
COMMENT ON COLUMN "public"."innovation_method"."apply_scene" IS '适用场景';
COMMENT ON COLUMN "public"."innovation_method"."step_list" IS '步骤数组 [{step:1,question:"xxx"}]';
COMMENT ON COLUMN "public"."innovation_method"."prompt_template" IS '引导话术模板';

-- =====================================================
-- 表 8: Profile（用户资料）
-- =====================================================
CREATE SEQUENCE IF NOT EXISTS "public"."\"Profile_id_seq\"";

CREATE TABLE "public"."Profile" (
  "id" int4 NOT NULL DEFAULT nextval('"Profile_id_seq"'::regclass),
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "location" text,
  "bio" text,
  "company" text,
  "position" text,
  "joinDate" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "skills" _text DEFAULT ARRAY[]::text[],
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "avatar" text,
  CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Profile_email_key" ON "public"."Profile" USING btree (
  "email" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- =====================================================
-- 表 9: user_session（用户会话）
-- =====================================================
CREATE TABLE "public"."user_session" (
  "session_id" varchar(64) NOT NULL,
  "user_input" text NOT NULL,
  "current_status" varchar(32) NOT NULL DEFAULT 'analyze'::character varying,
  "current_step" int4 DEFAULT 1,
  "create_time" timestamp(6) DEFAULT CURRENT_TIMESTAMP,
  "update_time" timestamp(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_session_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX "idx_session_status" ON "public"."user_session" USING btree (
  "current_status" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

COMMENT ON COLUMN "public"."user_session"."user_input" IS '用户初始需求';
COMMENT ON COLUMN "public"."user_session"."current_status" IS 'analyze(拆解)/diverge(发散)/finish(完成)';
COMMENT ON COLUMN "public"."user_session"."current_step" IS '当前执行步骤';

-- =====================================================
-- 表结构汇总
-- =====================================================
-- 
-- 表名            | 主键类型           | 索引数量 | 外键引用
-- -----------------------------------------------------------------
-- agent_log       | id (自增序列)      | 0        | 0
-- AIConfig        | id (自增序列)      | 1        | 0
-- creative_list   | id (自增序列)      | 1        | 1 → user_session
-- demand_anchor   | id (自增序列)      | 1        | 1 → user_session
-- global_prompt   | id (自增序列)      | 1        | 0
-- innovation_case | id (自增序列)      | 0        | 0
-- innovation_method | id (自增序列)    | 1        | 0
-- Profile         | id (自增序列)      | 1        | 0
-- user_session    | session_id (手动)  | 1        | 被 2 个表引用
-- 
-- 总计: 9 张表, 7 个自增序列, 7 个索引, 2 个外键约束
-- =====================================================
