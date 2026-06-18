import json
import logging
from datetime import datetime, timezone, timedelta
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.database import get_db
from app.models.user import User, ChatSession, ChatMessage, MessageRole, Feedback, AiConfig
from app.schemas.chat import (
    CreateSessionRequest,
    UpdateSessionRequest,
    SessionResponse,
    SessionListResponse,
    MessageResponse,
    MessageListResponse,
    ChatCompletionRequest,
    ChatCompletionResponse,
    StopGenerationRequest,
    FeedbackRequest,
    EditMessageRequest,
    RegenerateRequest,
)
from app.api.deps import get_current_user
from app.core.llm import llm_service
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:24]}"


async def _verify_session_owner(db: AsyncSession, session_id: str, user_id: str) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    return session


# ========== 会话 ==========


@router.get("/sessions")
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100, alias="pageSize"),
    archived: bool | None = None,
):
    where = [ChatSession.user_id == current_user.id]
    if archived is not None:
        where.append(ChatSession.is_archived == archived)

    count_q = select(func.count()).select_from(ChatSession).where(*where)
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = (
        select(ChatSession)
        .where(*where)
        .order_by(ChatSession.updated_at.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
    )
    result = await db.execute(q)
    sessions = result.scalars().all()

    session_list = []
    for s in sessions:
        msg_q = (
            select(ChatMessage)
            .where(ChatMessage.session_id == s.id)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        msg_result = await db.execute(msg_q)
        last_msg = msg_result.scalar_one_or_none()

        session_list.append(SessionResponse(
            id=s.id,
            title=s.title,
            model=s.model,
            modelConfig=s.model_config,
            messageCount=s.message_count or 0,
            lastMessage={
                "content": last_msg.content[:150] if last_msg else None,
                "role": last_msg.role.value if last_msg else None,
                "createdAt": last_msg.created_at.isoformat() if last_msg else None,
            } if last_msg else None,
            createdAt=s.created_at,
            updatedAt=s.updated_at,
            isArchived=s.is_archived or False,
        ))

    return SessionListResponse(sessions=session_list, total=total, page=page, pageSize=pageSize)


@router.post("/sessions")
async def create_session(
    dto: CreateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = ChatSession(
        id=_gen_id("sess_"),
        user_id=current_user.id,
        title=dto.title or "新对话",
        model=dto.model or settings.llm_default_model,
        system_prompt=dto.systemPrompt,
    )
    db.add(session)
    await db.flush()
    await db.commit()
    await db.refresh(session)

    return SessionResponse(
        id=session.id,
        title=session.title,
        model=session.model,
        modelConfig=session.model_config,
        messageCount=session.message_count or 0,
        lastMessage=None,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
        isArchived=session.is_archived or False,
    )


@router.get("/sessions/{sessionId}")
async def get_session(
    sessionId: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _verify_session_owner(db, sessionId, current_user.id)
    return SessionResponse(
        id=session.id,
        title=session.title,
        model=session.model,
        modelConfig=session.model_config,
        messageCount=session.message_count or 0,
        lastMessage=None,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
        isArchived=session.is_archived or False,
    )


@router.put("/sessions/{sessionId}")
async def update_session(
    sessionId: str,
    dto: UpdateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _verify_session_owner(db, sessionId, current_user.id)
    if dto.title is not None:
        session.title = dto.title
    if dto.model is not None:
        session.model = dto.model
    if dto.modelConfig is not None:
        session.model_config = dto.modelConfig
    await db.flush()
    await db.refresh(session)
    return SessionResponse(
        id=session.id,
        title=session.title,
        model=session.model,
        modelConfig=session.model_config,
        messageCount=session.message_count or 0,
        lastMessage=None,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
        isArchived=session.is_archived or False,
    )


@router.delete("/sessions/{sessionId}")
async def delete_session(
    sessionId: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    archive: bool | None = Query(None),
):
    session = await _verify_session_owner(db, sessionId, current_user.id)
    if archive is not False:
        session.is_archived = True
        await db.flush()
        return {"message": "会话已归档"}
    else:
        await db.execute(sa_delete(ChatMessage).where(ChatMessage.session_id == sessionId))
        await db.delete(session)
        await db.flush()
        return {"message": "会话已删除"}


# ========== 消息 ==========


@router.get("/sessions/{sessionId}/messages")
async def get_messages(
    sessionId: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: str | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    direction: str = Query("before"),
):
    await _verify_session_owner(db, sessionId, current_user.id)

    where = [ChatMessage.session_id == sessionId]
    if cursor:
        cursor_result = await db.execute(
            select(ChatMessage).where(ChatMessage.id == cursor)
        )
        cursor_msg = cursor_result.scalar_one_or_none()
        if cursor_msg:
            if direction == "before":
                where.append(ChatMessage.created_at < cursor_msg.created_at)
            else:
                where.append(ChatMessage.created_at > cursor_msg.created_at)

    order_col = ChatMessage.created_at.desc() if direction == "before" else ChatMessage.created_at.asc()
    q = (
        select(ChatMessage)
        .where(*where)
        .order_by(order_col)
        .limit(limit + 1)
    )
    result = await db.execute(q)
    messages = result.scalars().all()

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    # before 模式需要反转顺序
    if direction == "before":
        messages = list(reversed(messages))

    next_cursor = messages[-1].id if messages and has_more else None

    return MessageListResponse(
        messages=[
            MessageResponse(
                id=m.id,
                sessionId=m.session_id,
                role=m.role.value,
                content=m.content,
                contentBlocks=m.content_blocks,
                tokenCount=m.token_count,
                feedback=m.feedback.value if m.feedback else "none",
                metadata=m.extra_metadata,
                parentMessageId=m.parent_message_id,
                createdAt=m.created_at,
                updatedAt=m.updated_at,
            )
            for m in messages
        ],
        nextCursor=next_cursor,
        hasMore=has_more,
    )


@router.put("/sessions/{sessionId}/messages/{messageId}")
async def edit_message(
    sessionId: str,
    messageId: str,
    dto: EditMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_session_owner(db, sessionId, current_user.id)
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == messageId,
            ChatMessage.session_id == sessionId,
            ChatMessage.user_id == current_user.id,
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")
    if msg.role != MessageRole.user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅允许编辑用户消息")

    msg.content = dto.content
    await db.flush()
    await db.refresh(msg)

    if dto.regenerate:
        return await _do_regenerate(current_user.id, messageId, msg.session_id, db)

    return MessageResponse(
        id=msg.id,
        sessionId=msg.session_id,
        role=msg.role.value,
        content=msg.content,
        contentBlocks=msg.content_blocks,
        tokenCount=msg.token_count,
        feedback=msg.feedback.value if msg.feedback else "none",
        metadata=msg.extra_metadata,
        parentMessageId=msg.parent_message_id,
        createdAt=msg.created_at,
        updatedAt=msg.updated_at,
    )


# ========== 对话补全 ==========


@router.post("/completions")
async def chat_completion(
    dto: ChatCompletionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_id = dto.sessionId
    if not session_id:
        session = ChatSession(
            id=_gen_id("sess_"),
            user_id=current_user.id,
            title=dto.message[:50] or "新对话",
            model=dto.model or settings.llm_default_model,
            system_prompt=dto.systemPrompt,
        )
        db.add(session)
        await db.flush()
        session_id = session.id

    # 深度思考 -> 推理模型
    model = dto.model or settings.llm_default_model
    if dto.deepThink:
        model = "deepseek-reasoner"

    user_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=current_user.id,
        role=MessageRole.user,
        content=dto.message,
        parent_message_id=dto.parentMessageId,
    )
    db.add(user_msg)

    result = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = result.scalar_one_or_none()
    if session:
        session.message_count = (session.message_count or 0) + 1
    await db.flush()

    # 构建消息上下文
    messages = await _build_message_context(db, session_id, dto.systemPrompt)
    messages.append({"role": "user", "content": dto.message})

    if dto.stream is False:
        # 非流式
        try:
            result_data = await llm_service.chat_completion(
                messages=messages,
                model=model,
                temperature=dto.temperature,
                max_tokens=dto.maxTokens,
                stream=False,
            )
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LLM API 错误: {e.response.status_code}",
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LLM API 连接失败: {str(e)}",
            )
        content = result_data.get("choices", [{}])[0].get("message", {}).get("content", "")

        assistant_msg_id = _gen_id("msg_")
        assistant_msg = ChatMessage(
            id=assistant_msg_id,
            session_id=session_id,
            user_id=current_user.id,
            role=MessageRole.assistant,
            content=content,
            parent_message_id=user_msg.id,
            token_count=len(content) // 4,
        )
        db.add(assistant_msg)

        if session:
            session.message_count = (session.message_count or 0) + 1
            session.last_message_id = assistant_msg_id
        await db.commit()

        return ChatCompletionResponse(
            id=f"chatcmpl_{uuid4().hex[:24]}",
            sessionId=session_id,
            model=model,
            choices=[{
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finishReason": "stop",
            }],
            usage={
                "promptTokens": len(dto.message) // 4,
                "completionTokens": len(content) // 4,
                "totalTokens": (len(dto.message) + len(content)) // 4,
            },
            createdAt=datetime.now(timezone.utc).isoformat(),
        )

    # 流式
    assistant_msg_id = _gen_id("msg_")
    run_id = f"run_{uuid4().hex[:24]}"

    async def event_generator():
        collected_content: list[str] = []

        # 1) RUN_STARTED
        yield f'data: {json.dumps({"type": "RUN_STARTED", "threadId": session_id, "runId": run_id}, ensure_ascii=False)}\n\n'

        # 2) 流式输出 AG-UI 事件
        async for sse_str in llm_service.stream_agui(
            messages=messages,
            assistant_msg_id=assistant_msg_id,
            model=model,
            temperature=dto.temperature,
            max_tokens=dto.maxTokens,
        ):
            # 收集文本内容用于持久化
            if isinstance(sse_str, str) and "TEXT_MESSAGE_CONTENT" in sse_str:
                try:
                    match = sse_str.strip().removeprefix("data: ")
                    parsed = json.loads(match)
                    if parsed.get("type") == "TEXT_MESSAGE_CONTENT" and parsed.get("delta"):
                        collected_content.append(parsed["delta"])
                except (json.JSONDecodeError, KeyError, AttributeError):
                    pass
            yield sse_str

        # 3) RUN_FINISHED
        yield f'data: {json.dumps({"type": "RUN_FINISHED", "threadId": session_id, "runId": run_id}, ensure_ascii=False)}\n\n'

        # 4) 持久化
        full_content = "".join(collected_content)
        if full_content:
            assistant_msg = ChatMessage(
                id=assistant_msg_id,
                session_id=session_id,
                user_id=current_user.id,
                role=MessageRole.assistant,
                content=full_content,
                parent_message_id=user_msg.id,
                token_count=len(full_content) // 4,
            )
            db.add(assistant_msg)

            result2 = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
            session2 = result2.scalar_one_or_none()
            if session2:
                session2.message_count = (session2.message_count or 0) + 1
                session2.last_message_id = assistant_msg_id
            await db.commit()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/completions/stop")
async def stop_generation(
    dto: StopGenerationRequest,
    current_user: User = Depends(get_current_user),
):
    return {"message": "stopped"}


# ========== 反馈 ==========


@router.post("/messages/{messageId}/feedback")
async def set_feedback(
    messageId: str,
    dto: FeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == messageId,
            ChatMessage.user_id == current_user.id,
        )
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")

    msg.feedback = Feedback(dto.feedback)
    await db.flush()
    return {"message": "反馈已提交"}


# ========== 重新生成 ==========


@router.post("/messages/{messageId}/regenerate")
async def regenerate(
    messageId: str,
    dto: RegenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage).where(
            ChatMessage.id == messageId,
            ChatMessage.user_id == current_user.id,
        )
    )
    original_msg = result.scalar_one_or_none()
    if not original_msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="消息不存在")

    return await _do_regenerate(current_user.id, messageId, original_msg.session_id, db, dto)


# ========== 辅助函数 ==========


async def _build_message_context(
    db: AsyncSession,
    session_id: str,
    override_system_prompt: str | None = None,
) -> list[dict]:
    messages: list[dict] = []

    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()

    # System prompt
    system_prompt = override_system_prompt or (session.system_prompt if session else None)
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    # 历史消息（最近 20 条）
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id, ChatMessage.role != "system")
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    )
    history = history_result.scalars().all()
    messages.extend(
        {"role": m.role.value, "content": m.content}
        for m in reversed(history)
    )

    return messages


async def _do_regenerate(
    user_id: str,
    parent_message_id: str,
    session_id: str,
    db: AsyncSession,
    dto: RegenerateRequest | None = None,
) -> MessageResponse:
    messages = await _build_message_context(db, session_id)

    # 找到父消息位置，只取到父消息为止
    parent_result = await db.execute(
        select(ChatMessage).where(ChatMessage.id == parent_message_id)
    )
    parent_msg = parent_result.scalar_one_or_none()
    if parent_msg:
        parent_idx = next(
            (i for i, m in enumerate(messages) if m.get("role") == "user" and m.get("content") == parent_msg.content),
            -1,
        )
        if parent_idx >= 0:
            messages = messages[:parent_idx + 1]

    result_data = await llm_service.chat_completion(
        messages=messages,
        model=dto.model if dto else None,
        temperature=dto.temperature if dto else None,
        stream=False,
    )
    content = result_data.get("choices", [{}])[0].get("message", {}).get("content", "")

    new_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=user_id,
        role=MessageRole.assistant,
        content=content,
        parent_message_id=parent_message_id,
        token_count=len(content) // 4,
    )
    db.add(new_msg)

    session_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if session:
        session.message_count = (session.message_count or 0) + 1
        session.last_message_id = new_msg.id

    await db.commit()
    await db.refresh(new_msg)

    return MessageResponse(
        id=new_msg.id,
        sessionId=new_msg.session_id,
        role=new_msg.role.value,
        content=new_msg.content,
        contentBlocks=new_msg.content_blocks,
        tokenCount=new_msg.token_count,
        feedback=new_msg.feedback.value if new_msg.feedback else "none",
        metadata=new_msg.extra_metadata,
        parentMessageId=new_msg.parent_message_id,
        createdAt=new_msg.created_at,
        updatedAt=new_msg.updated_at,
    )