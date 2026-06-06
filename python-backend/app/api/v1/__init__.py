from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.chat import router as chat_router
from app.api.v1.user import router as user_router
from app.api.v1.system import router as system_router
from app.api.v1.upload import router as upload_router

router = APIRouter()

router.include_router(auth_router)
router.include_router(chat_router)
router.include_router(user_router)
router.include_router(system_router)
router.include_router(upload_router)