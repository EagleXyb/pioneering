from __future__ import annotations

import hashlib
import logging
import math
import time
import uuid
from typing import Any, Dict, List, Optional

from core.interfaces.memory import BaseMemory

logger = logging.getLogger(__name__)

_EMBEDDING_DIM = 384


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
    ) -> None:
        self._collection_prefix = collection_prefix
        self._top_k = top_k
        self._client: Optional[Any] = None
        self._use_sentence_transformer: Optional[bool] = None

    def _get_client(self) -> Any:
        if self._client is None:
            import chromadb

            self._client = chromadb.Client()
            logger.info("ChromaDB in-memory client initialized")
        return self._client

    def _embed_texts(self, texts: List[str]) -> List[List[float]]:
        if self._use_sentence_transformer is None:
            try:
                from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

                fn = SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")
                fn([__name__])
                self._use_sentence_transformer = True
                self._st_fn = fn
                logger.info("Using SentenceTransformer embedding")
            except Exception as e:
                logger.warning("SentenceTransformer unavailable (%s), using hash embedding", e)
                self._use_sentence_transformer = False

        if self._use_sentence_transformer:
            return self._st_fn(texts)

        return [_simple_hash_embedding(t) for t in texts]

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
