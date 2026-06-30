from contextlib import asynccontextmanager
import json
import logging
import logging.handlers
import os
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.api.v1 import router as v1_router

logger = logging.getLogger(__name__)


def _setup_logging() -> None:
    """配置日志持久化：按日轮转，保留 30 天。"""
    # 统一使用项目根目录的 logs/backend
    # __file__ = apps/backend/app/main.py，需要 4 次 dirname 到达项目根目录
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    log_dir = os.path.join(project_root, "logs", "backend")
    
    os.makedirs(log_dir, exist_ok=True)

    file_handler = logging.handlers.TimedRotatingFileHandler(
        filename=os.path.join(log_dir, "agent.log"),
        when="midnight",
        backupCount=30,
        encoding="utf-8",
    )
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    file_handler.setLevel(logging.INFO)
    logging.getLogger().addHandler(file_handler)


_setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        logger.info("数据库连接成功")
    except Exception as e:
        logger.warning("数据库连接失败，服务将以无数据库模式启动: %s", e)
    yield


app = FastAPI(
    title="IAC Incubator API",
    description="创路 Agent 后端服务 (Python / FastAPI)",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===== ResponseInterceptor =====
# 对所有非 SSE 响应统一包装为 { code, data, message } 格式
@app.middleware("http")
async def response_wrapper(request: Request, call_next):
    # 跳过 FastAPI 内置文档路由（/docs、/redoc、/openapi.json）
    skip_paths = {"/docs", "/redoc", "/openapi.json", "/docs/", "/redoc/"}
    if request.url.path in skip_paths or request.url.path.startswith(("/docs/", "/redoc/")):
        return await call_next(request)

    response = await call_next(request)

    # 跳过 SSE 流式响应
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type or "text/html" in content_type:
        return response

    # 跳过 204 等无 body 响应
    if response.status_code == 204:
        return response

    # 保留原始响应头（含 CORS 头）
    original_headers = dict(response.headers)

    # 读取原始响应体
    body = b""
    async for chunk in response.__dict__.get("body_iterator", []):
        body += chunk

    # 构建包装后的内容
    wrapped_content = {"code": response.status_code, "data": None, "message": "success"}

    if body:
        try:
            original = json.loads(body)
            if response.status_code < 400:
                wrapped_content["data"] = original
            else:
                error_msg = original.get("detail", str(original)) if isinstance(original, dict) else str(original)
                wrapped_content = {
                    "code": response.status_code,
                    "message": error_msg,
                    "details": error_msg,
                    "requestId": str(uuid.uuid4()),
                }
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    new_response = JSONResponse(content=wrapped_content, status_code=response.status_code)

    # 恢复原始响应头（CORS 等中间件设置的头部）
    for key, value in original_headers.items():
        # 跳过 content-length 和 content-type（JSONResponse 会自动设置）
        if key.lower() not in ("content-length", "content-type", "transfer-encoding"):
            new_response.headers[key] = value

    return new_response


app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

app.include_router(v1_router)
