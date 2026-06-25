import os
from uuid import uuid4
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, File as FileModel
from app.api.deps import get_current_user
from app.config import settings

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
}


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    file_type: str = Form(""),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的文件类型")

    ext = ALLOWED_TYPES.get(file.content_type, "")
    filename = f"{uuid4().hex}{ext}"
    upload_dir = Path(settings.upload_dir) / "avatars"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / filename

    content = await file.read()
    if len(content) > settings.max_upload_size:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件大小超过限制")

    file_path.write_bytes(content)

    db_file = FileModel(
        id=f"file_{uuid4().hex[:24]}",
        user_id=current_user.id,
        original_name=file.filename or filename,
        file_type=file.content_type,
        file_size=len(content),
        file_path=str(file_path),
        url=f"/uploads/avatars/{filename}",
    )
    db.add(db_file)
    await db.flush()

    return {
        "id": db_file.id,
        "url": db_file.url,
        "original_name": db_file.original_name,
        "file_type": db_file.file_type,
        "file_size": db_file.file_size,
    }


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select

    result = await db.execute(
        select(FileModel).where(FileModel.id == file_id, FileModel.user_id == current_user.id)
    )
    db_file = result.scalar_one_or_none()
    if not db_file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")

    if db_file.file_path and os.path.exists(db_file.file_path):
        os.remove(db_file.file_path)

    await db.delete(db_file)
    await db.flush()
    return {"message": "文件已删除"}