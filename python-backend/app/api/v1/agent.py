from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
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
from app.core.agent_bridge import stream_agent_completion
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
        outputResult=None,  # 大 payload 需单独请求
        status=e.status or "pending",
        errorMessage=e.error_message,
        durationMs=e.duration_ms,
        startTime=e.start_time,
        endTime=e.end_time,
    )


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
        # 新建会话
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

    if dto.stream:

        async def event_generator():
            content_blocks = None
            answer_content = ""
            prompt_tokens = 0
            completion_tokens = 0
            latency_ms = 0
            tool_executions = None

            async for sse_line in stream_agent_completion(
                message=dto.message,
                session_id=session_id,
                user_id=current_user.id,
                model=getattr(session, "model", None) if session else None,
                system_prompt=getattr(session, "system_prompt", None) if session else None,
            ):
                # 检查是否是 metadata 消息
                if isinstance(sse_line, dict) and "data" in sse_line:
                    try:
                        parsed = json.loads(sse_line["data"])
                    except (json.JSONDecodeError, TypeError):
                        yield sse_line
                        continue

                    if parsed.get("type") == "__agent_metadata__":
                        content_blocks = parsed.get("contentBlocks")
                        answer_content = parsed.get("answerContent", "")
                        prompt_tokens = parsed.get("promptTokens", 0)
                        completion_tokens = parsed.get("completionTokens", 0)
                        latency_ms = parsed.get("latencyMs", 0)
                        tool_executions = parsed.get("toolExecutions", [])
                        continue  # 不发给前端
                    else:
                        yield sse_line
                else:
                    yield sse_line

            # 持久化 assistant 消息
            assistant_msg = ChatMessage(
                id=_gen_id("msg_"),
                session_id=session_id,
                user_id=current_user.id,
                role=MessageRole.assistant,
                content=answer_content,
                content_blocks=content_blocks,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=latency_ms,
            )
            db.add(assistant_msg)

            # 持久化工具执行记录
            if tool_executions:
                for te in tool_executions:
                    start_dt = None
                    end_dt = None
                    try:
                        if te.get("startTime"):
                            start_dt = datetime.fromisoformat(te["startTime"])
                        if te.get("endTime"):
                            end_dt = datetime.fromisoformat(te["endTime"])
                    except (ValueError, TypeError):
                        pass

                    exec_record = AgentToolExecution(
                        id=_gen_id("exec_"),
                        message_id=assistant_msg.id,
                        session_id=session_id,
                        user_id=current_user.id,
                        tool_name=te.get("toolName", ""),
                        tool_call_id=te.get("toolCallId"),
                        input_params=te.get("inputParams"),
                        output_result=te.get("outputResult"),
                        output_summary=te.get("outputSummary"),
                        status=te.get("status", "pending"),
                        error_message=te.get("errorMessage"),
                        start_time=start_dt,
                        end_time=end_dt,
                    )
                    db.add(exec_record)

            if session:
                session.message_count = (session.message_count or 0) + 1
                session.last_message_id = assistant_msg.id
            await db.commit()

        return EventSourceResponse(event_generator())

    # 非流式
    content_blocks = None
    answer_content = ""
    prompt_tokens = 0
    completion_tokens = 0
    latency_ms = 0
    tool_executions = None

    async for sse_line in stream_agent_completion(
        message=dto.message,
        session_id=session_id,
        user_id=current_user.id,
        model=getattr(session, "model", None) if session else None,
        system_prompt=getattr(session, "system_prompt", None) if session else None,
    ):
        if isinstance(sse_line, dict) and "data" in sse_line:
            try:
                parsed = json.loads(sse_line["data"])
            except (json.JSONDecodeError, TypeError):
                continue

            if parsed.get("type") == "__agent_metadata__":
                content_blocks = parsed.get("contentBlocks")
                answer_content = parsed.get("answerContent", "")
                prompt_tokens = parsed.get("promptTokens", 0)
                completion_tokens = parsed.get("completionTokens", 0)
                latency_ms = parsed.get("latencyMs", 0)
                tool_executions = parsed.get("toolExecutions", [])

    assistant_msg = ChatMessage(
        id=_gen_id("msg_"),
        session_id=session_id,
        user_id=current_user.id,
        role=MessageRole.assistant,
        content=answer_content,
        content_blocks=content_blocks,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
    )
    db.add(assistant_msg)

    if tool_executions:
        for te in tool_executions:
            start_dt = None
            end_dt = None
            try:
                if te.get("startTime"):
                    start_dt = datetime.fromisoformat(te["startTime"])
                if te.get("endTime"):
                    end_dt = datetime.fromisoformat(te["endTime"])
            except (ValueError, TypeError):
                pass

            exec_record = AgentToolExecution(
                id=_gen_id("exec_"),
                message_id=assistant_msg.id,
                session_id=session_id,
                user_id=current_user.id,
                tool_name=te.get("toolName", ""),
                tool_call_id=te.get("toolCallId"),
                input_params=te.get("inputParams"),
                output_result=te.get("outputResult"),
                output_summary=te.get("outputSummary"),
                status=te.get("status", "pending"),
                error_message=te.get("errorMessage"),
                start_time=start_dt,
                end_time=end_dt,
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
