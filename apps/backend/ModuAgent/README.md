# ModuAgent

模块化 Agent 框架，支持多模态感知（文本/图像/音频）、LLM 推理、工具调用、
长期记忆与持续进化。基于 LangGraph 图编排实现可观测、可回放的 Agent 流程。

## 快速开始

### 环境要求

- Python >= 3.11
- 依赖：httpx, langgraph, langchain-core, langchain-openai, chromadb

### 安装

```bash
cd apps/backend/ModuAgent
pip install -e ".[dev]"
```

### 配置

通过环境变量或配置文件覆盖默认配置：

```bash
# 环境变量方式
export MODU_LLM_PROVIDER=deepseek
export MODU_LLM_TEMPERATURE=0.7
export MODU_CONFIG_PATH=/path/to/config.json   # 可选：JSON 配置文件
```

关键配置项（`config/runtime_config.py`）：

| 配置路径 | 默认值 | 说明 |
|---------|--------|------|
| `llm.default_provider` | `deepseek` | LLM 提供商 |
| `llm.temperature` | `0.7` | LLM 温度 |
| `llm.retry.max_attempts` | `2` | LLM 调用重试次数 |
| `tools.retry.max_attempts` | `3` | 工具调用重试次数 |
| `perception.sensitivity_threshold` | `5` | 敏感度熔断阈值 |
| `feedback.quality_monitor_mode` | `rule` | 质量评估模式（rule/llm/hybrid） |
| `feedback.enable_evolution` | `True` | 启用进化闭环 |

### 运行测试

```bash
cd apps/backend/ModuAgent
python -m pytest tests/ -v
```

### 使用示例

```python
from langgraph import get_runner, run_sync

graph = get_runner()
result = await run_sync(
    graph=graph,
    user_id="user1",
    session_id="session1",
    input_data={"input_type": "text", "prompt": "你好"},
)
print(result["data"]["response"])
```

## 架构概览

```
START → perception → [熔断?]
                        ├─ Yes → response → feedback → memory_update → END
                        └─ No  → memory_query → agent ⇄ tools → response → feedback → memory_update → END
```

核心层：
- **感知层** (`components/perception/`): 文本/图像/音频多模态输入处理 + 安全检测
- **推理层** (`components/reasoning/`): LLM 推理引擎（DeepSeek/GPT/Qwen/GLM）
- **行动层** (`components/action/`): 工具库 + 执行器
- **记忆层** (`components/memory/`): 向量存储 + 短期缓存
- **反馈闭环** (`feedback/` + `evolution/`): 质量评估 → 进化策略 → 参数调优
- **编排层** (`langgraph/`): LangGraph StateGraph 图编排

详细设计见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 目录结构


│   ├── __init__.py
│   ├── interfaces/            # 组件抽象协议（关键！所有实现必须遵循）
│   │   ├── perception.py    # BasePerception, BaseSensor
│   │   ├── reasoning.py     # BaseReasoningEngine, BaseReasoningStrategy
│   │   ├── memory.py        # BaseMemory, BaseStorageAdapter
│   │   ├── action.py        # BaseActionExecutor, BaseTool
│   │   └── feedback.py      # BaseFeedbackLoop, BaseEvolutionSignal
│   └── registry.py          # 组件动态注册中心（实现运行时替换）
│
├── components/                # 独立组件实现（完全解耦）
│   ├── perception/           # 感知层实现
│   │   ├── __init__.py
│   │   ├── vision/           # 视觉感知模块
│   │   │   ├── camera.py
│   │   │   └── image_processor.py
│   │   ├── audio/            # 音频感知模块
│   │   └── text/             # 文本感知模块
│   │       ├── llm_parser.py
│   │       └── rule_based.py
│   │
│   ├── reasoning/            # 推理层实现
│   │   ├── __init__.py
│   │   ├── llm/              # LLM推理引擎
│   │   │   ├── qwen.py      # 通义千问适配
│   │   │   ├── gpt.py       # GPT适配
│   │   │   └── base_llm.py
│   │   └── symbolic/         # 符号推理引擎
│   │       └── rule_engine.py
│   │
│   ├── memory/               # 记忆层实现
│   │   ├── __init__.py
│   │   ├── vector/           # 向量存储
│   │   │   ├── chroma.py
│   │   │   └── faiss.py
│   │   ├── relational/       # 关系型存储
│   │   └── cache/            # 临时缓存
│   │       └── redis_adapter.py
│   │
│   └── action/               # 行动层实现
│       ├── __init__.py
│       ├── tools/            # 工具库
│       │   ├── search.py
│       │   ├── calculator.py
│       │   └── api_client.py
│       └── executors/         # 执行器
│           ├── synchronous.py
│           └── async_executor.py
│
├── feedback/                  # 反馈驱动核心（系统粘合剂）
│   ├── __init__.py
│   ├── loop_controller.py   # 反馈循环管理器
│   ├── quality_monitor.py   # 输出质量评估器
│   ├── evolution_signal.py  # 进化信号生成器
│   └── metrics/             # 评估指标体系
│       ├── accuracy.py
│       └── efficiency.py
│
├── evolution/                 # 持续进化机制
│   ├── __init__.py
│   ├── strategy/             # 进化策略
│   │   ├── component_swap.py
│   │   └── parameter_tune.py
│   └── registry/             # 进化知识库
│       ├── versioned_store.py
│       └── rollback_mechanism.py
│
├── orchestration/             # 多Agent协作框架（预留扩展点）
│   ├── __init__.py
│   ├── coordinator.py       # 协同控制器
│   ├── communication/       # 通信协议
│   │   ├── message_bus.py
│   │   └── protocol.py
│   └── patterns/            # 协作模式
│       ├── consensus.py
│       └── delegation.py
│
├── adapters/                  # 标准化接口适配层
│   ├── __init__.py
│   ├── llm_adapter.py       # LLM标准化适配
│   ├── tool_adapter.py      # 工具调用适配
│   └── storage_adapter.py   # 存储抽象层
│
├── config/                    # 配置管理
│   ├── __init__.py
│   ├── schemas.py           # 配置验证模式
│   └── runtime_config.py    # 动态配置加载
│
├── tests/                     # 测试体系（按组件分层）
│   ├── unit/
│   │   └── components/      # 组件单元测试
│   ├── integration/
│   │   └── feedback_loop/   # 反馈循环集成测试
│   └── e2e/
│       └── evolution/       # 进化能力端到端测试
│
├── examples/                  # 可运行示例
│   ├── single_agent.py      # 单Agent基础用例
│   └── multi_agent/         # 多Agent协作示例
│
├── pyproject.toml             # 现代Python项目配置
├── README.md                  # 架构说明文档
└── ARCHITECTURE.md            # 详细设计文档（含组件交互图）
```