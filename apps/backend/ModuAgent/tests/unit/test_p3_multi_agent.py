"""P3-12.3.1 多 Agent 协作单元测试。

覆盖技术方案 §6.2.1 测试矩阵：
    - 子图状态隔离
    - Send 并行分发
    - 三种共识策略（多数投票/加权聚合/LLM 裁决）
    - 共识失败与进化信号
    - 多 Agent 禁用回退
    - 超时降级
    - 性能基线

测试分两类：
    1. 不依赖本地 langgraph 包的测试（共识策略/协议/配置/性能）——直接运行
    2. 依赖本地 langgraph 包的测试（state/nodes/graph/subgraph）——导入失败时跳过
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import MagicMock

import pytest

pytest.importorskip("langchain_core")


# 尝试导入本地 langgraph 模块（可能因包名冲突跳过）
_LANGGRAPH_AVAILABLE = False
try:
    from langgraph.state import ModuAgentState, make_initial_state  # noqa: F401
    _LANGGRAPH_AVAILABLE = True
except BaseException:
    pass

# 定义跳过标记
skip_no_langgraph = pytest.mark.skipif(
    not _LANGGRAPH_AVAILABLE,
    reason="local langgraph package not importable (name shadowing with installed library)",
)


# ============================================================
# 1. 共识策略测试（不依赖本地 langgraph 包）
# ============================================================

class TestConsensusStrategies:
    """三种共识策略测试。"""

    def test_majority_vote_two_identical(self):
        """3 个结果中 2 个相同 → 多数投票通过。"""
        from orchestration.patterns.consensus import MajorityVoteStrategy

        results = [
            {"output": "answer A", "task_type": "research"},
            {"output": "answer A", "task_type": "coding"},
            {"output": "answer B", "task_type": "review"},
        ]
        consensus = MajorityVoteStrategy().aggregate(results, quorum=2)
        assert consensus["agreement_count"] == 2
        assert consensus["strategy"] == "majority_vote"

    def test_majority_vote_empty_results(self):
        """空结果列表 → consensus=None。"""
        from orchestration.patterns.consensus import MajorityVoteStrategy

        consensus = MajorityVoteStrategy().aggregate([], quorum=2)
        assert consensus["consensus"] is None
        assert consensus["agreement_count"] == 0

    def test_majority_vote_all_different(self):
        """全部不同时取第一个作为最大组。"""
        from orchestration.patterns.consensus import MajorityVoteStrategy

        results = [
            {"output": "A", "task_type": "r"},
            {"output": "B", "task_type": "c"},
            {"output": "C", "task_type": "v"},
        ]
        consensus = MajorityVoteStrategy().aggregate(results, quorum=2)
        assert consensus["agreement_count"] == 1  # 每组1个
        assert consensus["group_count"] == 3

    def test_weighted_aggregate_picks_highest_weight(self):
        """加权聚合选择权重最高的结果。"""
        from orchestration.patterns.consensus import WeightedAggregateStrategy

        results = [
            {"output": "low", "task_type": "review"},
            {"output": "high", "task_type": "research"},
            {"output": "mid", "task_type": "coding"},
        ]
        weights = {"research": 0.5, "coding": 0.3, "review": 0.2}
        consensus = WeightedAggregateStrategy(weights=weights).aggregate(results, quorum=2)
        assert consensus["strategy"] == "weighted"
        assert consensus["best_weight"] == 0.5

    def test_weighted_aggregate_default_weight(self):
        """无配置权重时使用默认权重 1.0。"""
        from orchestration.patterns.consensus import WeightedAggregateStrategy

        results = [{"output": "A", "task_type": "r"}]
        consensus = WeightedAggregateStrategy().aggregate(results, quorum=1)
        assert consensus["best_weight"] == 1.0

    def test_llm_judge_selects_winner(self, mock_judge_llm):
        """LLM Judge 从多个结果中选最优。"""
        from orchestration.patterns.consensus import LLMJudgeStrategy

        results = [
            {"output": "candidate 1", "task_type": "research"},
            {"output": "candidate 2", "task_type": "coding"},
            {"output": "candidate 3", "task_type": "review"},
        ]
        strategy = LLMJudgeStrategy(judge_llm=mock_judge_llm, task_description="test")
        consensus = strategy.aggregate(results, quorum=2)
        assert consensus["strategy"] == "llm_judge"
        assert consensus["winner_index"] == 0

    def test_llm_judge_fallback_on_no_llm(self):
        """无 judge_llm 时降级为多数投票。"""
        from orchestration.patterns.consensus import LLMJudgeStrategy

        results = [
            {"output": "A", "task_type": "r"},
            {"output": "A", "task_type": "c"},
        ]
        strategy = LLMJudgeStrategy(judge_llm=None)
        consensus = strategy.aggregate(results, quorum=2)
        assert consensus["agreement_count"] == 2

    def test_llm_judge_parse_error_fallback(self):
        """LLM 返回非 JSON 时降级取第一个。"""
        from orchestration.patterns.consensus import LLMJudgeStrategy

        mock_llm = MagicMock()
        mock_llm.invoke.return_value = MagicMock(content="not valid json")
        strategy = LLMJudgeStrategy(judge_llm=mock_llm)
        results = [{"output": "A"}, {"output": "B"}]
        consensus = strategy.aggregate(results, quorum=2)
        assert consensus["strategy"] == "llm_judge_fallback"

    def test_create_strategy_by_name(self):
        """create_consensus_strategy 按名称创建策略。"""
        from orchestration.patterns.consensus import (
            MajorityVoteStrategy, WeightedAggregateStrategy, LLMJudgeStrategy,
            create_consensus_strategy,
        )

        assert isinstance(create_consensus_strategy("majority_vote"), MajorityVoteStrategy)
        assert isinstance(create_consensus_strategy("weighted"), WeightedAggregateStrategy)
        assert isinstance(create_consensus_strategy("llm_judge", judge_llm=MagicMock()), LLMJudgeStrategy)

    def test_create_strategy_unknown_raises(self):
        """未知策略名抛出 ValueError。"""
        from orchestration.patterns.consensus import create_consensus_strategy

        with pytest.raises(ValueError):
            create_consensus_strategy("unknown_strategy")

    def test_consensus_pattern_quorum_validation(self):
        """quorum < 1 抛出 ValueError。"""
        from orchestration.patterns.consensus import ConsensusPattern

        with pytest.raises(ValueError):
            ConsensusPattern(quorum=0)


# ============================================================
# 2. ConsensusPattern 集成测试
# ============================================================

class TestConsensusPattern:
    """ConsensusPattern 并行调用与共识。"""

    @pytest.mark.asyncio
    async def test_reach_consensus_success(self):
        """成功共识：3 个参与者，2 个结果一致。"""
        from orchestration.patterns.consensus import ConsensusPattern

        async def participant(data):
            return {"status": "success", "data": {"output": "same answer"}}

        async def participant_diff(data):
            return {"status": "success", "data": {"output": "different"}}

        pattern = ConsensusPattern(quorum=2)
        result = await pattern.reach_consensus(
            [participant, participant, participant_diff], {"prompt": "test"},
        )
        assert result["status"] == "success"
        assert result["data"]["agreement_count"] >= 2

    @pytest.mark.asyncio
    async def test_consensus_quorum_failure(self):
        """有效结果 < quorum → CONSENSUS_002。"""
        from orchestration.patterns.consensus import ConsensusPattern

        async def fail_participant(data):
            raise RuntimeError("failed")

        async def success_participant(data):
            return {"status": "success", "data": {"output": "only one"}}

        pattern = ConsensusPattern(quorum=2)
        result = await pattern.reach_consensus(
            [fail_participant, success_participant], {"prompt": "test"},
        )
        assert result["status"] == "error"
        assert result["error_code"] == "CONSENSUS_002"

    @pytest.mark.asyncio
    async def test_consensus_not_enough_participants(self):
        """参与者不足 → CONSENSUS_001。"""
        from orchestration.patterns.consensus import ConsensusPattern

        async def participant(data):
            return {"status": "success", "data": {"output": "answer"}}

        pattern = ConsensusPattern(quorum=3)
        result = await pattern.reach_consensus([participant], {"prompt": "test"})
        assert result["status"] == "error"
        assert result["error_code"] == "CONSENSUS_001"

    @pytest.mark.asyncio
    async def test_consensus_timeout(self):
        """超时 → CONSENSUS_003。"""
        from orchestration.patterns.consensus import ConsensusPattern

        async def slow_participant(data):
            await asyncio.sleep(10)
            return {"status": "success", "data": {"output": "late"}}

        pattern = ConsensusPattern(quorum=1)
        result = await pattern.reach_consensus(
            [slow_participant], {"prompt": "test"}, timeout_ms=100,
        )
        assert result["status"] == "error"
        assert result["error_code"] == "CONSENSUS_003"

    @pytest.mark.asyncio
    async def test_consensus_failure_emits_evolution_signal(self):
        """共识失败 → 发布 FEEDBACK 事件 → EvolutionSignalCollector 采集。"""
        from orchestration.patterns.consensus import ConsensusPattern
        from orchestration.communication.message_bus import EventBus
        from feedback.evolution_signal import EvolutionSignalCollector

        bus = EventBus()
        collector = EvolutionSignalCollector(report_interval=1)
        bus.subscribe(collector.on_agent_event)

        async def fail_participant(data):
            raise RuntimeError("failed")

        pattern = ConsensusPattern(quorum=2, event_bus=bus)
        await pattern.reach_consensus(
            [fail_participant, fail_participant],
            {"prompt": "test", "trace_id": "t1", "session_id": "s1", "user_id": "u1"},
        )
        await asyncio.sleep(0.1)
        signals = collector.get_signals()
        assert len(signals) >= 1
        # source 格式为 "EventDomain.FEEDBACK:EventAction.ANALYZE"
        assert "FEEDBACK" in signals[-1].source
        # 确认 metadata 含共识失败标记
        ctx = signals[-1].context
        meta = ctx.get("metadata", {})
        assert meta.get("consensus_failed") == "true"

    @pytest.mark.asyncio
    async def test_consensus_sync_participant(self):
        """同步参与者函数也可工作。"""
        from orchestration.patterns.consensus import ConsensusPattern

        def sync_participant(data):
            return {"status": "success", "data": {"output": "sync answer"}}

        pattern = ConsensusPattern(quorum=1)
        result = await pattern.reach_consensus([sync_participant], {"prompt": "test"})
        assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_consensus_weighted_strategy(self):
        """使用加权策略的 ConsensusPattern。"""
        from orchestration.patterns.consensus import ConsensusPattern, WeightedAggregateStrategy

        async def p1(data):
            return {"status": "success", "data": {"output": "A", "task_type": "research"}}

        async def p2(data):
            return {"status": "success", "data": {"output": "B", "task_type": "review"}}

        strategy = WeightedAggregateStrategy(weights={"research": 0.7, "review": 0.3})
        pattern = ConsensusPattern(quorum=2, strategy=strategy)
        result = await pattern.reach_consensus([p1, p2], {"prompt": "test"})
        assert result["status"] == "success"
        assert result["data"]["strategy"] == "weighted"


# ============================================================
# 3. 协议扩展测试
# ============================================================

class TestProtocolExtension:
    """协议新增事件动作测试。"""

    def test_consensus_event_actions_exist(self):
        """CONSENSUS_REACHED / CONSENSUS_FAILED 动作存在。"""
        from orchestration.communication.protocol import EventAction

        assert EventAction.CONSENSUS_REACHED.value == "consensus_reached"
        assert EventAction.CONSENSUS_FAILED.value == "consensus_failed"

    def test_consensus_error_codes_exist(self):
        """共识错误码存在。"""
        from orchestration.communication.protocol import ErrorCode

        assert ErrorCode.CONSENSUS_NOT_ENOUGH_PARTICIPANTS == "CONSENSUS_001"
        assert ErrorCode.CONSENSUS_QUORUM_NOT_MET == "CONSENSUS_002"
        assert ErrorCode.CONSENSUS_STRATEGY_ERROR == "CONSENSUS_003"

    def test_hitl_event_actions_exist(self):
        """HITL 事件动作存在。"""
        from orchestration.communication.protocol import EventAction

        assert EventAction.HUMAN_REVIEW_REQUIRED.value == "human_review_required"
        assert EventAction.HUMAN_REVIEW_APPROVED.value == "human_review_approved"
        assert EventAction.HUMAN_REVIEW_REJECTED.value == "human_review_rejected"


# ============================================================
# 4. 配置测试
# ============================================================

class TestMultiAgentConfig:
    """多 Agent 配置项测试。"""

    def test_config_defaults_disabled(self, fresh_config):
        """默认配置下多 Agent 禁用。"""
        assert fresh_config.get("orchestration.multi_agent.enabled") is False

    def test_config_defaults_values(self, fresh_config):
        """默认配置值正确。"""
        cfg = fresh_config.get("orchestration.multi_agent", {})
        assert cfg["max_subagents"] == 5
        assert cfg["consensus_strategy"] == "majority_vote"
        assert cfg["consensus_quorum"] == 2
        assert cfg["subgraph_timeout_ms"] == 30000
        assert cfg["consensus_failure_as_evolution_signal"] is True

    def test_config_can_enable(self, fresh_config):
        """配置可启用。"""
        fresh_config.set("orchestration.multi_agent.enabled", True)
        assert fresh_config.get("orchestration.multi_agent.enabled") is True

    def test_config_strategy_changeable(self, fresh_config):
        """共识策略可切换。"""
        fresh_config.set("orchestration.multi_agent.consensus_strategy", "llm_judge")
        assert fresh_config.get("orchestration.multi_agent.consensus_strategy") == "llm_judge"

    def test_config_quorum_changeable(self, fresh_config):
        """quorum 可调整。"""
        fresh_config.set("orchestration.multi_agent.consensus_quorum", 3)
        assert fresh_config.get("orchestration.multi_agent.consensus_quorum") == 3


# ============================================================
# 5. 性能基线测试（不依赖本地 langgraph 包）
# ============================================================

class TestPerformanceBaseline:
    """P3-12.3.1 性能基线测试。"""

    def test_majority_vote_latency(self):
        """多数投票聚合延迟 < 1ms。"""
        from orchestration.patterns.consensus import MajorityVoteStrategy

        results = [{"output": f"answer_{i % 3}", "task_type": "r"} for i in range(10)]
        strategy = MajorityVoteStrategy()
        start = time.perf_counter()
        for _ in range(1000):
            strategy.aggregate(results, quorum=2)
        elapsed_ms = (time.perf_counter() - start) * 1000
        avg_ms = elapsed_ms / 1000
        assert avg_ms < 1.0

    @pytest.mark.asyncio
    async def test_parallel_vs_sequential_speedup(self):
        """3 个并行子 Agent vs 串行，加速比 ≥ 1.5x。"""
        from orchestration.patterns.consensus import ConsensusPattern

        async def slow_participant(data):
            await asyncio.sleep(0.1)
            return {"status": "success", "data": {"output": "done"}}

        participants = [slow_participant] * 3

        start = time.perf_counter()
        await ConsensusPattern(quorum=2).reach_consensus(participants, {"prompt": "test"})
        parallel_ms = (time.perf_counter() - start) * 1000

        start = time.perf_counter()
        for p in participants:
            await p({})
        sequential_ms = (time.perf_counter() - start) * 1000

        speedup = sequential_ms / parallel_ms
        assert speedup >= 1.5


# ============================================================
# 6. 以下测试依赖本地 langgraph 包（导入失败时跳过）
# ============================================================

@skip_no_langgraph
class TestStateExtension:
    """ModuAgentState 多 Agent 字段测试。"""

    def test_state_has_multi_agent_fields(self):
        """初始状态包含多 Agent 字段。"""
        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        assert state["subtasks"] == []
        assert state["subtask_results"] == {}
        assert state["consensus_result"] is None
        assert state["consensus_failed"] is False
        assert state["current_subtask"] == {}

    def test_subtask_results_reducer_merges(self):
        """merge_subtask_results reducer 正确合并字典。"""
        from langgraph.state import merge_subtask_results

        left = {"t1": {"output": "A"}}
        right = {"t2": {"output": "B"}}
        merged = merge_subtask_results(left, right)
        assert "t1" in merged
        assert "t2" in merged

    def test_subtask_results_reducer_right_wins(self):
        """同 task_id 时右值覆盖。"""
        from langgraph.state import merge_subtask_results

        left = {"t1": {"output": "old"}}
        right = {"t1": {"output": "new"}}
        merged = merge_subtask_results(left, right)
        assert merged["t1"]["output"] == "new"

    def test_subtask_results_reducer_empty(self):
        """空输入安全处理。"""
        from langgraph.state import merge_subtask_results

        assert merge_subtask_results({}, {}) == {}
        assert merge_subtask_results(None, {"t1": {}}) == {"t1": {}}


@skip_no_langgraph
class TestSubgraphStateIsolation:
    """子 Agent 状态隔离。"""

    def test_subagent_state_is_separate_type(self):
        """SubAgentState 与 ModuAgentState 字段不同。"""
        from langgraph.subgraph.states import SubAgentState, make_subagent_initial_state

        state = make_subagent_initial_state(
            task_id="test_1", task_type="research",
            task_input={"prompt": "test"}, trace_id="t1",
        )
        assert state["task_id"] == "test_1"
        assert state["task_type"] == "research"
        assert state["task_output"] is None
        assert state["messages"] == []

    def test_subagent_node_returns_only_subtask_results(self):
        """子 Agent 节点仅返回 subtask_results。"""
        from langgraph.nodes import make_subagent_node

        mock_llm = MagicMock()
        mock_llm.invoke.return_value = MagicMock(content="result")
        node = make_subagent_node(mock_llm)
        state = {
            "current_subtask": {
                "task_id": "t1", "task_type": "research",
                "task_input": {"prompt": "What is AI?"},
            }
        }
        result = node(state)
        assert "subtask_results" in result
        assert "t1" in result["subtask_results"]
        assert "current_subtask" not in result
        assert result["subtask_results"]["t1"]["status"] == "success"

    def test_subagent_node_llm_failure(self):
        """LLM 调用失败时返回 error 结果。"""
        from langgraph.nodes import make_subagent_node

        mock_llm = MagicMock()
        mock_llm.invoke = MagicMock(side_effect=RuntimeError("LLM down"))
        node = make_subagent_node(mock_llm)
        result = node({"current_subtask": {
            "task_id": "t1", "task_type": "research",
            "task_input": {"prompt": "test"},
        }})
        assert result["subtask_results"]["t1"]["status"] == "error"

    def test_subagent_node_empty_task(self):
        """空任务时返回空结果。"""
        from langgraph.nodes import make_subagent_node

        mock_llm = MagicMock()
        node = make_subagent_node(mock_llm)
        result = node({"current_subtask": {}})
        assert result == {"subtask_results": {}}


@skip_no_langgraph
class TestSendParallelDispatch:
    """Supervisor 通过 Send API 并行分发。"""

    def test_supervisor_node_decomposes_task(self, fresh_config):
        """Supervisor 节点正确拆分任务。"""
        from langgraph.subgraph.supervisor import make_supervisor_node

        fresh_config.set("orchestration.multi_agent.max_subagents", 3)
        node = make_supervisor_node()
        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "Analyze Python vs Rust", "input_type": "text"},
        )
        result = node(state)
        assert "subtasks" in result
        assert len(result["subtasks"]) == 3
        assert result["subtask_results"] == {}

    def test_supervisor_respects_max_subagents(self, fresh_config):
        """子任务数不超过 max_subagents。"""
        from langgraph.subgraph.supervisor import make_supervisor_node

        node = make_supervisor_node(max_subagents=2)
        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        result = node(state)
        assert len(result["subtasks"]) <= 2

    def test_route_from_supervisor_returns_sends(self):
        """route_from_supervisor 返回 Send 列表。"""
        from langgraph.subgraph.supervisor import route_from_supervisor

        state = {
            "subtasks": [
                {"task_id": "t1", "task_type": "research", "task_input": {}},
                {"task_id": "t2", "task_type": "coding", "task_input": {}},
                {"task_id": "t3", "task_type": "review", "task_input": {}},
            ]
        }
        sends = route_from_supervisor(state)
        assert len(sends) == 3

    def test_route_from_supervisor_empty_subtasks(self):
        """无子任务时返回空列表。"""
        from langgraph.subgraph.supervisor import route_from_supervisor

        sends = route_from_supervisor({"subtasks": []})
        assert sends == []


@skip_no_langgraph
class TestTaskDecomposition:
    """任务拆分函数测试。"""

    def test_decompose_default_task_types(self):
        """默认拆分为 research/coding/review 三类。"""
        from langgraph.subgraph.supervisor import decompose_task

        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        subtasks = decompose_task(state)
        assert len(subtasks) == 3
        types = [t["task_type"] for t in subtasks]
        assert types == ["research", "coding", "review"]

    def test_decompose_respects_max_subagents(self):
        """max_subagents 限制子任务数。"""
        from langgraph.subgraph.supervisor import decompose_task

        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        subtasks = decompose_task(state, max_subagents=1)
        assert len(subtasks) == 1

    def test_decompose_custom_task_types(self):
        """自定义任务类型列表。"""
        from langgraph.subgraph.supervisor import decompose_task

        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        subtasks = decompose_task(state, task_types=["analyze", "summarize"])
        assert len(subtasks) == 2
        assert subtasks[0]["task_type"] == "analyze"

    def test_decompose_unique_task_ids(self):
        """每个子任务有唯一 task_id。"""
        from langgraph.subgraph.supervisor import decompose_task

        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        subtasks = decompose_task(state)
        ids = [t["task_id"] for t in subtasks]
        assert len(ids) == len(set(ids))

    def test_decompose_carries_trace_id(self):
        """子任务携带 trace_id。"""
        from langgraph.subgraph.supervisor import decompose_task

        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="trace_abc",
            input_data={"prompt": "test", "input_type": "text"},
        )
        subtasks = decompose_task(state)
        for task in subtasks:
            assert task["task_input"]["trace_id"] == "trace_abc"


@skip_no_langgraph
class TestConsensusNode:
    """make_consensus_node 节点测试。"""

    @pytest.mark.asyncio
    async def test_consensus_node_success(self, fresh_config):
        """共识节点成功聚合结果。"""
        from langgraph.nodes import make_consensus_node

        fresh_config.set("orchestration.multi_agent.enabled", True)
        fresh_config.set("orchestration.multi_agent.consensus_quorum", 2)
        node = make_consensus_node()
        state = {
            "subtask_results": {
                "t1": {"task_id": "t1", "status": "success", "output": "answer A"},
                "t2": {"task_id": "t2", "status": "success", "output": "answer A"},
                "t3": {"task_id": "t3", "status": "success", "output": "answer B"},
            },
            "subtasks": [{"task_id": "t1"}, {"task_id": "t2"}, {"task_id": "t3"}],
            "trace_id": "t1", "session_id": "s1", "user_id": "u1",
            "input_data": {"prompt": "test"},
        }
        result = await node(state)
        assert result["consensus_failed"] is False
        assert "response" in result
        assert result["consensus_result"]["status"] == "success"

    @pytest.mark.asyncio
    async def test_consensus_node_quorum_failure(self, fresh_config):
        """共识节点 quorum 不足时标记失败。"""
        from langgraph.nodes import make_consensus_node

        fresh_config.set("orchestration.multi_agent.enabled", True)
        fresh_config.set("orchestration.multi_agent.consensus_quorum", 2)
        node = make_consensus_node()
        state = {
            "subtask_results": {
                "t1": {"task_id": "t1", "status": "success", "output": "only one"},
                "t2": {"task_id": "t2", "status": "error", "output": ""},
            },
            "subtasks": [{"task_id": "t1"}, {"task_id": "t2"}],
            "trace_id": "t1", "session_id": "s1", "user_id": "u1",
            "input_data": {"prompt": "test"},
        }
        result = await node(state)
        assert result["consensus_failed"] is True

    @pytest.mark.asyncio
    async def test_consensus_node_empty_results(self, fresh_config):
        """共识节点无结果时标记失败。"""
        from langgraph.nodes import make_consensus_node

        fresh_config.set("orchestration.multi_agent.enabled", True)
        node = make_consensus_node()
        state = {
            "subtask_results": {}, "subtasks": [],
            "trace_id": "t1", "session_id": "s1", "user_id": "u1",
            "input_data": {"prompt": "test"},
        }
        result = await node(state)
        assert result["consensus_failed"] is True

    @pytest.mark.asyncio
    async def test_consensus_node_llm_judge(self, fresh_config, mock_judge_llm):
        """共识节点使用 LLM Judge 策略。"""
        from langgraph.nodes import make_consensus_node
        from orchestration.patterns.consensus import LLMJudgeStrategy

        fresh_config.set("orchestration.multi_agent.enabled", True)
        strategy = LLMJudgeStrategy(judge_llm=mock_judge_llm, task_description="test")
        node = make_consensus_node(strategy=strategy)
        state = {
            "subtask_results": {
                "t1": {"task_id": "t1", "status": "success", "output": "c1"},
                "t2": {"task_id": "t2", "status": "success", "output": "c2"},
            },
            "subtasks": [{"task_id": "t1"}, {"task_id": "t2"}],
            "trace_id": "t1", "session_id": "s1", "user_id": "u1",
            "input_data": {"prompt": "test"},
        }
        result = await node(state)
        assert result["consensus_failed"] is False
        assert result["consensus_result"]["strategy"] == "llm_judge"


@skip_no_langgraph
class TestRoutingFunctions:
    """多 Agent 路由函数测试。"""

    def test_route_to_supervisor_when_enabled(self, fresh_config):
        """multi_agent 启用时路由到 supervisor。"""
        from langgraph.nodes import route_after_memory_query

        fresh_config.set("orchestration.multi_agent.enabled", True)
        assert route_after_memory_query({}) == "supervisor"

    def test_route_to_agent_when_disabled(self, fresh_config):
        """multi_agent 禁用时路由到 agent。"""
        from langgraph.nodes import route_after_memory_query

        assert route_after_memory_query({}) == "agent"


@skip_no_langgraph
class TestSubgraphBuilder:
    """build_subagent_subgraph 测试。"""

    def test_build_subgraph_basic(self):
        """基本子图构建。"""
        from langgraph.subgraph.builder import build_subagent_subgraph

        mock_llm = MagicMock()
        subgraph = build_subagent_subgraph(mock_llm, task_type="research")
        assert subgraph is not None
        assert subgraph.recursion_limit == 10

    def test_build_subgraph_with_tools(self):
        """带工具的子图构建。"""
        from langgraph.subgraph.builder import build_subagent_subgraph

        mock_llm = MagicMock()
        mock_tool = MagicMock()
        subgraph = build_subagent_subgraph(mock_llm, tools=[mock_tool], task_type="coding")
        assert subgraph is not None

    def test_build_subgraph_custom_recursion(self):
        """自定义递归限制。"""
        from langgraph.subgraph.builder import build_subagent_subgraph

        mock_llm = MagicMock()
        subgraph = build_subagent_subgraph(mock_llm, recursion_limit=20)
        assert subgraph.recursion_limit == 20

    def test_get_system_prompt_by_type(self):
        """按 task_type 获取系统提示词。"""
        from langgraph.subgraph.builder import _get_system_prompt

        assert "Research" in _get_system_prompt("research")
        assert "Code" in _get_system_prompt("coding")
        assert "Review" in _get_system_prompt("review")
        assert "Agent" in _get_system_prompt("unknown")

    def test_get_system_prompt_custom(self):
        """自定义提示词覆盖类型模板。"""
        from langgraph.subgraph.builder import _get_system_prompt

        assert _get_system_prompt("research", "Custom") == "Custom"


@skip_no_langgraph
class TestGraphBuildMultiAgent:
    """build_modu_graph 多 Agent 集成。"""

    def test_build_graph_multi_agent_disabled(self, fresh_config):
        """默认（multi_agent 关闭）行为与现有一致。"""
        from langgraph.graph import build_modu_graph

        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)
        graph = build_modu_graph(tools=[], llm=mock_llm, checkpointer=None, store=None)
        assert graph is not None
        assert graph.recursion_limit > 0

    def test_build_graph_multi_agent_enabled(self, fresh_config):
        """multi_agent 启用时图构建成功。"""
        from langgraph.graph import build_modu_graph

        fresh_config.set("orchestration.multi_agent.enabled", True)
        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)
        graph = build_modu_graph(tools=[], llm=mock_llm, checkpointer=None, store=None)
        assert graph is not None
        assert graph.recursion_limit >= 15

    def test_build_graph_custom_recursion_override(self, fresh_config):
        """自定义 recursion_limit 优先。"""
        from langgraph.graph import build_modu_graph

        fresh_config.set("orchestration.multi_agent.enabled", True)
        mock_llm = MagicMock()
        mock_llm.bind_tools = MagicMock(return_value=mock_llm)
        graph = build_modu_graph(tools=[], llm=mock_llm, recursion_limit=50)
        assert graph.recursion_limit == 50


@skip_no_langgraph
class TestSubagentPerformance:
    """子 Agent 性能测试。"""

    def test_subgraph_build_overhead(self):
        """子图构建开销 < 100ms。"""
        from langgraph.subgraph.builder import build_subagent_subgraph

        mock_llm = MagicMock()
        start = time.perf_counter()
        for _ in range(10):
            build_subagent_subgraph(mock_llm, task_type="research")
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert elapsed_ms / 10 < 100

    def test_task_decomposition_latency(self):
        """任务拆分延迟 < 5ms。"""
        from langgraph.subgraph.supervisor import decompose_task

        state = make_initial_state(
            user_id="u1", session_id="s1", trace_id="t1",
            input_data={"prompt": "test", "input_type": "text"},
        )
        start = time.perf_counter()
        for _ in range(100):
            decompose_task(state)
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert elapsed_ms / 100 < 5

    def test_merge_subtask_results_latency(self):
        """结果合并延迟 < 0.1ms。"""
        from langgraph.state import merge_subtask_results

        left = {f"t{i}": {"output": f"a{i}"} for i in range(10)}
        right = {f"t{i+10}": {"output": f"b{i}"} for i in range(10)}
        start = time.perf_counter()
        for _ in range(10000):
            merge_subtask_results(left, right)
        elapsed_ms = (time.perf_counter() - start) * 1000
        assert elapsed_ms / 10000 < 0.1
