-- 热表索引（对应 schema.prisma 中 ChatSession / ChatMessage 的 @@index）
--
-- 背景：TS 侧只 generate Client、不执行 migrate；表结构由 Python init_db() 维护。
-- 因此这里给出可直接在生产 PostgreSQL 执行的 DDL，用来补齐两张热表的查询索引。
--
-- 执行要求：
--   - 使用 CONCURRENTLY，避免长时间锁表（不能放在事务块里）；
--   - 大表避开业务高峰；
--   - 执行后用 EXPLAIN (ANALYZE, BUFFERS) 验证目标查询命中索引。
--
-- 回滚：
--   DROP INDEX CONCURRENTLY IF EXISTS idx_chat_messages_session_created;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_chat_sessions_user_archived_updated;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages (session_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_sessions_user_archived_updated
  ON chat_sessions (user_id, is_archived, updated_at DESC);
