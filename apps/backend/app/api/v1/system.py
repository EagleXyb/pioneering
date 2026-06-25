from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(tags=["system"])

SUPPORTED_MODELS = [
    {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "description": "DeepSeek 快速模型",
        "max_tokens": 128000,
        "pricing": {"input_price": 0.14, "output_price": 0.28},
    },
    {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "description": "DeepSeek 专业模型",
        "max_tokens": 128000,
        "pricing": {"input_price": 0.28, "output_price": 0.56},
    },
    {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini",
        "description": "轻量级多模态模型，适用于日常对话和代码生成",
        "max_tokens": 128000,
        "pricing": {"input_price": 0.15, "output_price": 0.6},
    },
    {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "description": "高性能多模态模型，适用于复杂任务",
        "max_tokens": 128000,
        "pricing": {"input_price": 2.5, "output_price": 10},
    },
]


@router.get("/system/models")
async def get_models():
    return SUPPORTED_MODELS


@router.get("/system/config")
async def get_config():
    return {
        "max_message_length": 10000,
        "max_session_count": 100,
        "supported_models": SUPPORTED_MODELS,
        "file_upload": {
            "max_size": 10485760,
            "allowed_types": [
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "application/pdf",
                "text/plain",
            ],
        },
    }


@router.get("/health")
async def get_health():
    return {
        "status": "healthy",
        "version": "0.1.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }