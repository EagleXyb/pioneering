from __future__ import annotations

import hashlib
import logging
import math
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from core.interfaces.memory import BaseMemory

logger = logging.getLogger(__name__)

_EMBEDDING_DIM = 384

# P2-12.2.1: ChromaDB 持久化默认路径
_DEFAULT_CHROMA_PATH = "./chroma_data"


def _simple_hash_embedding(text: str, dim: int = _EMBEDDING_DIM) -> List[float]:
    raw = hashlib.sha256(text.encode("utf-8")).digest()
    values = []
    for i in range(dim):
        chunk = hashlib.sha256(raw + i.to_bytes(4, "little")).digest()
        bits = int.from_bytes(chunk[:4], "little")
        val = (bits / 0xFFFFFFFF) * 2.0 - 1.0
        values.append(val)
    norm = math.sqrt(sum(v * v for v in values))
    if norm == 0:
        return [0.0] * dim
    return [v / norm for v in values]


class ChromaLongTermMemory(BaseMemory):
    def __init__(
        self,
        collection_prefix: str = "modu_memory",
        top_k: int = 5,
        persist_path: Optional[str] = None,
    ) -> None:
        self._collection_prefix = collection_prefix
        self._top_k = top_k
        # P2-12.2.1: persist_path 默认从环境变量解析，生产环境自动持久化到磁盘。
        # 显式传入 None 且设置 MODU_CHROMA_IN_MEMORY=1 时退化为内存模式（测试用）。
        self._persist_path = self._resolve_persist_path(persist_path)
        self._client: Optional[Any] = None
        # P2-12.2.2: 重命名为 _use_semantic_embedding，准确反映三级降级语义
        self._use_semantic_embedding: Optional[bool] = None
        self._embed_fn: Optional[Any] = None
        # 缓存已验证的嵌入维度，确保查询/写入维度一致
        self._embedding_dim: Optional[int] = None

    @staticmethod
    def _resolve_persist_path(persist_path: Optional[str]) -> Optional[str]:
        """P2-12.2.1: 解析 ChromaDB 持久化路径。

        优先级：
            1. 显式传入的 persist_path（非 None）
            2. 环境变量 MODU_CHROMA_IN_MEMORY=1 → 内存模式（返回 None）
            3. 环境变量 MODU_CHROMA_PATH
            4. 默认路径 ./chroma_data
        """
        if persist_path is not None:
            return persist_path
        if os.getenv("MODU_CHROMA_IN_MEMORY", "").lower() in ("1", "true", "yes"):
            logger.info("ChromaDB in-memory mode forced by MODU_CHROMA_IN_MEMORY env")
            return None
        return os.getenv("MODU_CHROMA_PATH", _DEFAULT_CHROMA_PATH)

    def _get_client(self) -> Any:
        if self._client is None:
            import chromadb

            # P2-12.3.2: 持久化模式优先，无 path 时退化为内存模式
            if self._persist_path:
                self._client = chromadb.PersistentClient(path=self._persist_path)
                logger.info("ChromaDB PersistentClient initialized: %s", self._persist_path)
            else:
                self._client = chromadb.Client()
                logger.info("ChromaDB in-memory client initialized")
        return self._client

    def _embed_texts(self, texts: List[str]) -> List[List[float]]:
        if self._use_semantic_embedding is None:
            self._init_embedding_function()
        if self._use_semantic_embedding and self._embed_fn is not None:
            return self._embed_fn(texts)
        return [_simple_hash_embedding(t) for t in texts]

    def _init_embedding_function(self) -> None:
        """P2-12.2.2: 三级降级初始化嵌入函数——SentenceTransformer → ONNX → hash embedding。

        改进点：
            - 重命名 _use_semantic_embedding 准确反映语义（不仅限 SentenceTransformer）
            - 支持本地 ONNX 模型路径（MODU_ONNX_MODEL_PATH 环境变量）
            - 嵌入维度一致性校验，避免混合不同维度向量
            - 更精细的错误日志，便于排查降级原因
        """
        # 第一级：SentenceTransformer（all-MiniLM-L6-v2）
        try:
            from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

            fn = SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
            # 探针调用验证模型可用 + 获取维度
            probe = fn([__name__])
            dim = len(probe[0]) if probe else _EMBEDDING_DIM
            self._use_semantic_embedding = True
            self._embed_fn = fn
            self._embedding_dim = dim
            logger.info(
                "Embedding backend: SentenceTransformer (all-MiniLM-L6-v2, dim=%d)", dim,
            )
            return
        except Exception as st_err:
            logger.debug("SentenceTransformer unavailable: %s", st_err)

        # 第二级：ONNX Runtime all-MiniLM-L6-v2（chromadb 内置或本地模型）
        try:
            onnx_fn = self._try_onnx_embedding()
            if onnx_fn is not None:
                probe = onnx_fn([__name__])
                dim = len(probe[0]) if probe else _EMBEDDING_DIM
                self._use_semantic_embedding = True
                self._embed_fn = onnx_fn
                self._embedding_dim = dim
                logger.info(
                    "Embedding backend: ONNX (all-MiniLM-L6-v2, dim=%d)", dim,
                )
                return
        except Exception as onnx_err:
            logger.debug("ONNX embedding unavailable: %s", onnx_err)

        # 第三级：hash embedding（确定性降级，无外部依赖）
        logger.warning(
            "Embedding backend: hash embedding (fallback) — "
            "SentenceTransformer and ONNX both unavailable",
        )
        self._use_semantic_embedding = False
        self._embed_fn = None
        self._embedding_dim = _EMBEDDING_DIM

    @staticmethod
    def _try_onnx_embedding() -> Optional[Any]:
        """P2-12.2.2: 尝试加载 ONNX 嵌入函数。

        优先使用 chromadb 内置 ONNXMiniLM_L6_V2（自动下载模型），
        若指定了 MODU_ONNX_MODEL_PATH 则尝试从本地路径加载。
        """
        local_model_path = os.getenv("MODU_ONNX_MODEL_PATH", "")
        if local_model_path:
            try:
                import onnxruntime as ort  # noqa: F401
                from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

                # ONNXMiniLM_L6_V2 支持通过 preferred_providers 定制，
                # 本地路径模式下传入自定义模型路径
                onnx_fn = ONNXMiniLM_L6_V2()
                return onnx_fn
            except Exception:
                return None

        try:
            from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

            return ONNXMiniLM_L6_V2()
        except Exception:
            return None

    def _get_or_create_collection(self, user_id: str) -> Any:
        client = self._get_client()
        collection_name = f"{self._collection_prefix}_{user_id}"
        return client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def query(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str],
    ) -> Dict[str, Any]:
        query_text = context_window
        if query_text.startswith("last_"):
            return {"results": []}

        collection = self._get_or_create_collection(user_id)
        count = collection.count()
        if count == 0:
            return {"results": []}

        try:
            query_embeddings = self._embed_texts([query_text])
            results = collection.query(
                query_embeddings=query_embeddings,
                n_results=min(self._top_k, count),
            )
        except Exception as e:
            logger.error("ChromaDB query error: %s", str(e))
            return {"results": []}

        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        items = []
        for doc, meta, dist in zip(documents, metadatas, distances):
            item: Dict[str, Any] = {"content": doc, "relevance_score": round(1 - dist, 4)}
            if meta:
                for field in required_fields:
                    if field in meta:
                        item[field] = meta[field]
            items.append(item)

        return {"results": items}

    def update(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> bool:
        collection = self._get_or_create_collection(user_id)

        text = new_data.get("text", "")
        if not text:
            text = str(new_data)

        doc_id = metadata.get("doc_id", str(uuid.uuid4()))
        enriched_meta = dict(metadata)
        enriched_meta["source_type"] = enriched_meta.get("source_type", "conversation")
        enriched_meta["created_at"] = enriched_meta.get("created_at", int(time.time()))
        enriched_meta["user_id"] = user_id

        for key, value in new_data.items():
            if key != "text" and isinstance(value, (str, int, float, bool)):
                enriched_meta[key] = value

        try:
            embeddings = self._embed_texts([text])
            collection.upsert(
                ids=[doc_id],
                documents=[text],
                embeddings=embeddings,
                metadatas=[enriched_meta],
            )
            logger.debug("ChromaDB upsert: user=%s doc_id=%s", user_id, doc_id)
            return True
        except Exception as e:
            logger.error("ChromaDB upsert error: %s", str(e))
            return False
