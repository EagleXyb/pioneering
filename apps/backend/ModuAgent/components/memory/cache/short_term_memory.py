from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from core.interfaces.memory import BaseMemory

logger = logging.getLogger(__name__)


class InMemoryShortTermMemory(BaseMemory):
    """纯内存短期记忆实现。

    P2-3: 原 redis_adapter.py 名不副实（无 Redis），重命名为 short_term_memory.py
    以准确反映其实现。如需 Redis 支持，请新建 redis_short_term_memory.py。
    """

    def __init__(
        self,
        max_turns: int = 5,
        ttl_seconds: int = 3600,
    ) -> None:
        self._max_turns = max_turns
        self._ttl_seconds = ttl_seconds
        self._store: Dict[str, List[Dict[str, Any]]] = {}

    def query(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str],
    ) -> Dict[str, Any]:
        self._evict_expired(user_id)

        entries = self._store.get(user_id, [])
        if not entries:
            return {"history": []}

        limit = self._parse_context_window(context_window)
        recent = entries[-limit:]

        filtered = []
        for entry in recent:
            item = {k: v for k, v in entry.items() if k in required_fields}
            filtered.append(item)

        return {"history": filtered}

    def update(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any],
    ) -> bool:
        if user_id not in self._store:
            self._store[user_id] = []

        entry = dict(new_data)
        entry["_timestamp"] = metadata.get("timestamp", time.time())
        entry["_session_id"] = metadata.get("session_id", "")

        self._store[user_id].append(entry)

        if len(self._store[user_id]) > self._max_turns * 2:
            self._store[user_id] = self._store[user_id][-self._max_turns * 2 :]

        logger.debug("Memory updated for user %s, total entries: %d", user_id, len(self._store[user_id]))
        return True

    def _evict_expired(self, user_id: str) -> None:
        entries = self._store.get(user_id)
        if entries is None:
            return

        now = time.time()
        cutoff = now - self._ttl_seconds
        original_len = len(entries)
        self._store[user_id] = [e for e in entries if e.get("_timestamp", 0) > cutoff]

        if len(self._store[user_id]) < original_len:
            logger.debug(
                "Evicted %d expired entries for user %s",
                original_len - len(self._store[user_id]),
                user_id,
            )

    @staticmethod
    def _parse_context_window(context_window: str) -> int:
        if context_window.startswith("last_") and context_window.endswith("_turns"):
            try:
                return int(context_window[5:-6])
            except ValueError:
                pass
        return 5
