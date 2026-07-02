"""记忆适配器：ChromaLongTermMemory → LangGraph BaseStore。

将现有 components/memory/vector/chroma.py 的 ChromaLongTermMemory
包装为 LangGraph BaseStore，使 LangGraph 图可通过 Store API 检索长期记忆。

短期记忆由 LangGraph Checkpointer（MemorySaver / SqliteSaver）按 thread_id
自动管理整个 State，无需手写 query/update。

复用现有 ChromaLongTermMemory 的 _embed_texts / collection 逻辑，
不修改原组件代码。
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from langgraph.store.base import BaseStore, Item, Op

from components.memory.vector.chroma import ChromaLongTermMemory

logger = logging.getLogger(__name__)

# Store 命名空间分隔符
_NAMESPACE_SEP = "/"


def _namespace_to_str(namespace: Tuple[str, ...]) -> str:
    """将命名空间元组转为字符串键。"""
    return _NAMESPACE_SEP.join(namespace)


class ChromaStore(BaseStore):
    """将 ChromaLongTermMemory 包装为 LangGraph BaseStore。

    复用现有 ChromaLongTermMemory 的 _embed_texts / _get_or_create_collection 逻辑。
    内部委托给 ChromaLongTermMemory 实例，不修改原组件代码。

    命名空间映射：
        LangGraph Store 使用 (user_id, "knowledge") 作为 namespace
        ChromaLongTermMemory 使用 user_id 作为 collection 后缀
        → 将 namespace 第一个元素作为 user_id
    """

    def __init__(
        self,
        chroma_memory: Optional[ChromaLongTermMemory] = None,
        collection_prefix: str = "modu_memory",
        top_k: int = 5,
        persist_path: Optional[str] = None,
    ) -> None:
        """初始化 ChromaStore。

        Args:
            chroma_memory: 已有的 ChromaLongTermMemory 实例（None=新建）
            collection_prefix: Chroma collection 名称前缀
            top_k: 检索返回的最大结果数
            persist_path: ChromaDB 持久化路径（None=内存模式）
        """
        self._chroma = chroma_memory or ChromaLongTermMemory(
            collection_prefix=collection_prefix,
            top_k=top_k,
            persist_path=persist_path,
        )
        self._top_k = top_k

    def _resolve_user_id(self, namespace: Tuple[str, ...]) -> str:
        """从命名空间提取 user_id。"""
        if namespace and len(namespace) > 0:
            return namespace[0]
        return "default"

    def get(
        self,
        namespace: Tuple[str, ...],
        key: str,
        *,
        refresh_ttl: bool = True,
    ) -> Optional[Item]:
        """根据 key 获取单个记忆项。

        ChromaLongTermMemory 不支持按 key 精确查找，此处通过
        collection 的 get 方法实现。
        """
        user_id = self._resolve_user_id(namespace)
        try:
            collection = self._chroma._get_or_create_collection(user_id)
            result = collection.get(ids=[key])
            documents = result.get("documents", [])
            metadatas = result.get("metadatas", [])
            if documents and len(documents) > 0:
                return Item(
                    namespace=namespace,
                    key=key,
                    value={"content": documents[0]},
                    created_at=int(time.time()),
                    updated_at=int(time.time()),
                    score=1.0,
                )
        except Exception as e:
            logger.error("ChromaStore.get error: %s", str(e))
        return None

    def search(
        self,
        namespace: Tuple[str, ...],
        *,
        query: Optional[str] = None,
        filter: Optional[Dict[str, Any]] = None,
        limit: int = 10,
        offset: int = 0,
        refresh_ttl: bool = True,
    ) -> List[Item]:
        """语义检索长期记忆。

        委托给 ChromaLongTermMemory.query() 进行向量检索。

        Args:
            namespace: 命名空间（第一个元素为 user_id）
            query: 检索文本（语义相似度查询）
            filter: 元数据过滤条件
            limit: 最大返回数
            offset: 偏移量
        """
        user_id = self._resolve_user_id(namespace)

        if not query:
            # 无查询文本时返回空（Chroma 不支持纯浏览）
            return []

        try:
            result = self._chroma.query(
                user_id=user_id,
                context_window=query,
                required_fields=["content"],
            )
            items: List[Item] = []
            for entry in result.get("results", []):
                content = entry.get("content", "")
                relevance = entry.get("relevance_score", 0.0)
                items.append(
                    Item(
                        namespace=namespace,
                        key=str(uuid.uuid4()),
                        value={"content": content, **{k: v for k, v in entry.items() if k != "content"}},
                        created_at=int(time.time()),
                        updated_at=int(time.time()),
                        score=relevance,
                    )
                )
                if len(items) >= limit:
                    break
            return items
        except Exception as e:
            logger.error("ChromaStore.search error: %s", str(e))
            return []

    def put(
        self,
        namespace: Tuple[str, ...],
        key: str,
        value: Dict[str, Any],
        *,
        index: Optional[Union[List[str], int]] = None,
        ttl: Optional[float] = None,
    ) -> None:
        """写入长期记忆。

        委托给 ChromaLongTermMemory.update()。
        """
        user_id = self._resolve_user_id(namespace)

        text = value.get("content", "")
        if not text:
            text = value.get("text", "")

        if not text:
            logger.warning("ChromaStore.put: no text content in value")
            return

        metadata = {
            "doc_id": key,
            "created_at": int(time.time()),
            "source_type": value.get("source_type", "conversation"),
            "namespace": _namespace_to_str(namespace),
        }

        # 将 value 中的额外字段加入 metadata
        for k, v in value.items():
            if k not in ("content", "text") and isinstance(v, (str, int, float, bool)):
                metadata[k] = v

        try:
            self._chroma.update(
                user_id=user_id,
                new_data={"text": text},
                metadata=metadata,
            )
        except Exception as e:
            logger.error("ChromaStore.put error: %s", str(e))

    def delete(self, namespace: Tuple[str, ...], key: str) -> bool:
        """删除单个记忆项。"""
        user_id = self._resolve_user_id(namespace)
        try:
            collection = self._chroma._get_or_create_collection(user_id)
            collection.delete(ids=[key])
            return True
        except Exception as e:
            logger.error("ChromaStore.delete error: %s", str(e))
            return False

    def batch(self, ops: Sequence[Op]) -> None:
        """批量操作（简化实现：逐个执行）。"""
        for op in ops:
            # Op 是 NamedTuple，包含 namespace/key/value 等字段
            try:
                if hasattr(op, "value") and op.value is not None:
                    self.put(op.namespace, op.key, op.value)
                else:
                    self.delete(op.namespace, op.key)
            except Exception as e:
                logger.error("ChromaStore.batch op error: %s", str(e))


class InMemoryStoreAdapter(BaseStore):
    """轻量级内存 Store（不依赖 Chroma）。

    用于测试或无 Chroma 环境，替代 ChromaStore。
    """

    def __init__(self) -> None:
        self._store: Dict[str, Dict[str, Item]] = {}

    def _key(self, namespace: Tuple[str, ...]) -> str:
        return _namespace_to_str(namespace)

    def get(
        self,
        namespace: Tuple[str, ...],
        key: str,
        *,
        refresh_ttl: bool = True,
    ) -> Optional[Item]:
        ns = self._store.get(self._key(namespace))
        if ns is None:
            return None
        return ns.get(key)

    def search(
        self,
        namespace: Tuple[str, ...],
        *,
        query: Optional[str] = None,
        filter: Optional[Dict[str, Any]] = None,
        limit: int = 10,
        offset: int = 0,
        refresh_ttl: bool = True,
    ) -> List[Item]:
        ns = self._store.get(self._key(namespace), {})
        items = list(ns.values())
        return items[offset:offset + limit]

    def put(
        self,
        namespace: Tuple[str, ...],
        key: str,
        value: Dict[str, Any],
        *,
        index: Optional[Union[List[str], int]] = None,
        ttl: Optional[float] = None,
    ) -> None:
        ns_key = self._key(namespace)
        if ns_key not in self._store:
            self._store[ns_key] = {}
        now = int(time.time())
        self._store[ns_key][key] = Item(
            namespace=namespace,
            key=key,
            value=value,
            created_at=now,
            updated_at=now,
            score=1.0,
        )

    def delete(self, namespace: Tuple[str, ...], key: str) -> bool:
        ns = self._store.get(self._key(namespace))
        if ns is None:
            return False
        return ns.pop(key, None) is not None

    def batch(self, ops: Sequence[Op]) -> None:
        for op in ops:
            try:
                if hasattr(op, "value") and op.value is not None:
                    self.put(op.namespace, op.key, op.value)
                else:
                    self.delete(op.namespace, op.key)
            except Exception as e:
                logger.error("InMemoryStoreAdapter.batch op error: %s", str(e))
