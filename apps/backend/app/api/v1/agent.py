from __future__ import annotations

import json
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.models.user import (
    User,
    ChatSession,
    ChatMessage,
    MessageRole,
    AgentToolExecution,
)
from app.schemas.agent import (
    AgentSessionResponse,
    AgentMessageResponse,
    AgentFeedbackRequest,
    AgentChatRequest,
    CreateAgentSessionRequest,
    ExecutionListResponse,
    ExecutionResultResponse,
    ToolExecutionDetail,
    ErrorResponse,
)
from app.api.deps import get_current_user
from app.core.agent_bridge import stream_agent_completion, StreamContext
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["Agent"])


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid4().hex[:24]}"


async def _verify_session_owner(db: AsyncSession, session_id: str, user_id: str) -> ChatSession:
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    return session


def _session_to_response(s: ChatSession) -> AgentSessionResponse:
    return AgentSessionResponse(
        id=s.id,
        title=s.title,
        agentMode=s.agent_mode,
        model=s.model,
        modelConfig=s.model_config,
        systemPrompt=s.system_prompt,
        messageCount=s.message_count or 0,
        createdAt=s.created_at,
        updatedAt=s.updated_at,
    )


def _message_to_response(m: ChatMessage) -> AgentMessageResponse:
    return AgentMessageResponse(
        id=m.id,
        sessionId=m.session_id,
        role=m.role.value if m.role else "assistant",
        content=m.content or "",
        contentBlocks=m.content_blocks,
        promptTokens=m.prompt_tokens,
        completionTokens=m.completion_tokens,
        latencyMs=m.latency_ms,
        userRating=m.user_rating,
        userFeedback=m.user_feedback,
        createdAt=m.created_at,
    )


def _execution_to_detail(e: AgentToolExecution) -> ToolExecutionDetail:
    return ToolExecutionDetail(
        id=e.id,
        messageId=e.message_id,
        toolName=e.tool_name or "",
        toolCallId=e.tool_call_id,
        inputParams=e.input_params,
        outputSummary=e.output_summary,
        outputResult=None,
        status=e.status or "pending",
        errorMessage=e.error_message,
        durationMs=e.duration_ms,
        startTime=e.start_time,
        endTime=e.end_time,
    )


async def _load_session_history(
    db: AsyncSession, session_id: str, limit: int = 20,
) -> list[dict[str, str]]:
    """从数据库加载会话历史消息，供 LLM 多轮上下文使用。"""
    q = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(q)
    messages = list(reversed(result.scalars().all()))
    return [
        {"role": m.role.value if m.role else "user", "content": m.content or ""}
        for m in messages
    ]


# ========== 会话管理 ==========


@router.post("/sessions", status_code=201)
async def create_agent_session(
    dto: CreateAgentSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = ChatSession(
        id=_gen_id("sess_"),
        user_id=current_user.id,
        title=dto.title or "新对话",
        model=dto.model or settings.llm_default_model,
        system_prompt=dto.systemPrompt,
        agent_mode=dto.agentMode,
    )
    if dto.tools:
        session.model_config = {"tools": dto.tools}
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _session_to_response(session)


@router.get("/sessions/{sessionId}")
async def get_agent_session(
    sessionId: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _verify_session_owner(db, sessionId, current_user.id)
    return _session_to_response(session)


@router.get("/sessions/{sessionId}/messages")
async def get_agent_session_messages(
    sessionId: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_session_owner(db, sessionId, current_user.id)
    q = (
        select(ChatMessage)
        .where(ChatMessage.session_id == sessionId)
        .order_by(ChatMessage.created_at.asc())
    )
    result = await db.execute(q)
    messages = result.scalars().all()
    return [_message_to_response(m) for m in messages]


# ========== 对话执行 ==========


@router.post("/completions")
async def agent_completion(
    dto: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_id = dto.sessionId
    if not session_id:
        session = ChatSession(
            id=_gen_id("sess_"),
            user_id=current_user.id,
            title=dto.message[:50],
            model=settings.llm_default_model,
            agent_mode="react_agent",
        )
        db.add(session)
        await db.flush()
        session_id = session.id

    # 写入用户消息
    user_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=current_user.id,
        role=MessageRole.user,
        content=dto.message,
    )
    db.add(user_msg)

    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session:
        session.message_count = (session.message_count or 0) + 1
    await db.commit()

    # 加载会话历史
    history = await _load_session_history(db, session_id)

    if dto.stream:

        async def event_generator():
            ctx = StreamContext()

            # 使用后端配置的默认模型（与 base URL 一致），忽略会话中存储的 model 避免 GLM Client 400
            async for event_dict in stream_agent_completion(
                message=dto.message,
                session_id=session_id,
                user_id=current_user.id,
                ctx=ctx,
                model=None,
                system_prompt=getattr(session, "system_prompt", None) if session else None,
                history=history,
            ):
                yield event_dict

            # 流结束，使用 ctx 持久化 assistant 消息
            assistant_msg = ChatMessage(
                id=_gen_id("msg_"),
                session_id=session_id,
                user_id=current_user.id,
                role=MessageRole.assistant,
                content=ctx.answer_content,
                content_blocks=ctx.content_blocks if ctx.content_blocks else None,
                prompt_tokens=ctx.prompt_tokens,
                completion_tokens=ctx.completion_tokens,
                latency_ms=ctx.latency_ms,
            )
            db.add(assistant_msg)

            # 持久化工具执行记录
            for te in ctx.tool_executions:
                exec_record = AgentToolExecution(
                    id=_gen_id("exec_"),
                    message_id=assistant_msg.id,
                    session_id=session_id,
                    user_id=current_user.id,
                    tool_name=te.get("toolName", ""),
                    tool_call_id=te.get("executionId", ""),
                    input_params=te.get("inputParams"),
                    output_result=te.get("outputResult"),
                    output_summary=te.get("outputSummary"),
                    status=te.get("status", "pending"),
                    error_message=te.get("errorMessage"),
                )
                db.add(exec_record)

            if session:
                session.message_count = (session.message_count or 0) + 1
                session.last_message_id = assistant_msg.id
            await db.commit()

        return EventSourceResponse(event_generator())

    # 非流式
    ctx = StreamContext()
    async for _ in stream_agent_completion(
        message=dto.message,
        session_id=session_id,
        user_id=current_user.id,
        ctx=ctx,
        model=None,
        system_prompt=getattr(session, "system_prompt", None) if session else None,
        history=history,
    ):
        pass

    assistant_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=current_user.id,
        role=MessageRole.assistant,
        content=ctx.answer_content,
        content_blocks=ctx.content_blocks if ctx.content_blocks else None,
        prompt_tokens=ctx.prompt_tokens,
        completion_tokens=ctx.completion_tokens,
        latency_ms=ctx.latency_ms,
    )
    db.add(assistant_msg)

    for te in ctx.tool_executions:
        exec_record = AgentToolExecution(
            id=_gen_id("exec_"),
            message_id=assistant_msg.id,
            session_id=session_id,
            user_id=current_user.id,
            tool_name=te.get("toolName", ""),
            tool_call_id=te.get("executionId", ""),
            input_params=te.get("inputParams"),
            output_result=te.get("outputResult"),
            output_summary=te.get("outputSummary"),
            status=te.get("status", "pending"),
            error_message=te.get("errorMessage"),
        )
        db.add(exec_record)

    if session:
        session.message_count = (session.message_count or 0) + 1
        session.last_message_id = assistant_msg.id

    await db.commit()
    await db.refresh(assistant_msg)

    return _message_to_response(assistant_msg)


# ========== 工具执行轨迹查询 ==========


@router.get("/messages/{messageId}/executions")
async def get_message_executions(
    messageId: str,
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

    exec_result = await db.execute(
        select(AgentToolExecution)
        .where(AgentToolExecution.message_id == messageId)
        .order_by(AgentToolExecution.created_at.asc())
    )
    executions = exec_result.scalars().all()
    return ExecutionListResponse(
        executions=[_execution_to_detail(e) for e in executions]
    )


@router.get("/executions/{executionId}/result")
async def get_execution_result(
    executionId: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentToolExecution).where(AgentToolExecution.id == executionId)
    )
    exec_record = result.scalar_one_or_none()
    if not exec_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="执行记录不存在")

    return ExecutionResultResponse(
        executionId=exec_record.id,
        outputResult=exec_record.output_result,
    )


# ========== 深度反馈闭环 ==========


@router.post("/messages/{messageId}/feedback")
async def submit_message_feedback(
    messageId: str,
    dto: AgentFeedbackRequest,
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

    msg.user_rating = dto.rating
    msg.user_feedback = dto.feedbackText
    await db.commit()

    return {"message": "反馈已提交"}
