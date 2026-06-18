from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field


# ========== 通用响应 ==========

class ErrorResponse(BaseModel):
    code: int = Field(..., description="业务状态码")
    message: str = Field(..., description="错误提示信息")
    details: Optional[str] = Field(None, description="详细错误信息（调试用）")
    requestId: Optional[str] = Field(None, description="请求唯一标识（用于问题追踪）")


# ========== Agent 会话相关 ==========

class ModelConfig(BaseModel):
    temperature: Optional[float] = None
    maxTokens: Optional[int] = None


class CreateAgentSessionRequest(BaseModel):
    agentMode: str = Field(
        default="react_agent",
        description="Agent 模式标识",
        json_schema_extra={"enum": ["react_agent", "rag_agent"]},
    )
    title: Optional[str] = Field(None, description="会话标题")
    model: str = Field(default="gpt-4o", description="使用的模型标识")
    systemPrompt: Optional[str] = Field(None, description="自定义 System Prompt")
    tools: Optional[List[str]] = Field(
        None,
        description="允许该会话使用的工具列表 (为空则使用系统默认工具集)",
    )


class AgentSessionResponse(BaseModel):
    id: str = Field(..., description="会话唯一标识")
    title: Optional[str] = Field(None, description="会话标题")
    agentMode: Optional[str] = Field(None, description="Agent 模式标识")
    model: Optional[str] = Field(None, description="使用的模型标识")
    modelConfig: Optional[dict] = Field(None, description="模型参数配置")
    systemPrompt: Optional[str] = Field(None, description="系统提示词")
    messageCount: int = Field(default=0, description="消息数量")
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ========== Agent 内容块 ==========

class AgentContentBlock(BaseModel):
    type: str = Field(
        ...,
        description="节点类型",
        json_schema_extra={"enum": ["thinking", "tool_call", "text_stream"]},
    )
    status: str = Field(
        default="pending",
        description="该步骤的执行状态",
        json_schema_extra={"enum": ["pending", "running", "success", "error"]},
    )
    # thinking 专属
    summary: Optional[str] = Field(None, description="思考过程摘要或工具调用摘要")
    # tool_call 专属
    toolName: Optional[str] = Field(None, description="调用的工具名称")
    executionId: Optional[str] = Field(None, description="关联的工具执行明细 ID")
    # text_stream 专属
    text: Optional[str] = Field(None, description="流式输出的文本片段")


# ========== Agent 消息相关 ==========

class AgentMessageResponse(BaseModel):
    id: str = Field(..., description="消息唯一标识")
    sessionId: str = Field(..., description="会话 ID")
    role: str = Field(..., description="角色")
    content: str = Field(..., description="最终回复的纯文本内容 (Markdown)")
    contentBlocks: Optional[List[AgentContentBlock]] = Field(
        None,
        description="Agent 执行步骤轨迹",
    )
    # LLM 基础可观测性指标
    promptTokens: Optional[int] = Field(None, description="本次请求消耗的 Prompt Token 数")
    completionTokens: Optional[int] = Field(None, description="本次请求消耗的 Completion Token 数")
    latencyMs: Optional[int] = Field(None, description="LLM 接口响应总延迟 (毫秒)")
    # 用户反馈闭环
    userRating: Optional[int] = Field(None, ge=1, le=5, description="用户评分 (1-5星)")
    userFeedback: Optional[str] = Field(None, description="用户具体反馈/纠错文本")
    createdAt: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ========== Agent 对话请求/响应 ==========

class AgentChatRequest(BaseModel):
    sessionId: Optional[str] = Field(None, description="会话 ID (新建会话时可为空)")
    message: str = Field(..., description="用户指令")
    stream: bool = Field(default=True, description="是否流式输出 (SSE)")


class AgentFeedbackRequest(BaseModel):
    messageId: Optional[str] = Field(None, description="消息 ID")
    rating: int = Field(..., ge=1, le=5, description="评分 (1-5星)")
    feedbackText: Optional[str] = Field(None, description="具体纠错或建议文本")


# ========== 工具执行明细 ==========

class ToolExecutionDetail(BaseModel):
    id: str = Field(..., description="执行记录唯一 ID")
    messageId: Optional[str] = Field(None, description="关联的消息 ID")
    toolName: str = Field(..., description="工具名称")
    toolCallId: Optional[str] = Field(None, description="LLM 生成的 tool_call_id")
    inputParams: Optional[dict] = Field(None, description="工具输入参数 (JSON)")
    outputSummary: Optional[str] = Field(None, description="工具结果摘要 (供前端展示)")
    outputResult: Optional[str] = Field(None, description="工具执行原始结果 (按需获取)")
    status: str = Field(default="pending", description="执行状态")
    errorMessage: Optional[str] = Field(None, description="错误信息")
    durationMs: Optional[int] = Field(None, description="执行耗时 (毫秒)")
    startTime: Optional[datetime] = None
    endTime: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ExecutionListResponse(BaseModel):
    executions: List[ToolExecutionDetail]


class ExecutionResultResponse(BaseModel):
    executionId: str
    outputResult: Optional[str] = None
