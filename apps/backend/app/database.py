from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# 幂等补列清单：对已有表补充新字段（等价于手动执行 ALTER，可重复执行）。
# 约束：本项目不使用 prisma migrate / db push，表结构变更统一收敛在此处
# 与 models 定义中，PowerShell/psql 手动执行时用同样的语句即可。
_IDEMPOTENT_COLUMNS: list[tuple[str, str]] = [
    # 云边双模（阶段 0）：chat_sessions.runtime —— 会话归属运行时
    # 'cloud'=云端 backend（存量与默认），'local'=桌面端本地
    ("chat_sessions", "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS runtime VARCHAR(20) NOT NULL DEFAULT 'cloud'"),
]


async def init_db():
    """初始化数据库连接并创建表"""
    async with engine.begin() as conn:
        # 导入所有模型以确保它们被注册到 Base.metadata
        import app.models.user  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # create_all 只建新表、不加已有表的列；用幂等 ALTER 补齐（PostgreSQL）
        for _table, ddl in _IDEMPOTENT_COLUMNS:
            await conn.execute(text(ddl))