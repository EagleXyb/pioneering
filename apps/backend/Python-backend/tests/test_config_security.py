"""配置和安全性单元测试"""
from __future__ import annotations

import os
import pytest


class TestConfig:
    """app.config Settings 测试"""

    def test_cors_origins_not_wildcard(self):
        """CORS 配置不应为 * 通配符"""
        from app.config import settings
        assert settings.cors_origins != "*"
        origins = [o.strip() for o in settings.cors_origins.split(",")]
        assert len(origins) >= 1
        for o in origins:
            assert o.startswith("http://") or o.startswith("https://")

    def test_log_dir_configured(self):
        """日志目录配置应存在"""
        from app.config import settings
        assert hasattr(settings, "log_dir")
        assert settings.log_dir


class TestGitignore:
    """验证 .gitignore 包含关键忽略项"""

    def _gitignore_path(self):
        # tests/ -> Python-backend/ -> backend/ -> apps/ -> pioneering/
        return os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.dirname(os.path.dirname(__file__))))),
            ".gitignore",
        )

    def test_gitignore_exists(self):
        gitignore_path = self._gitignore_path()
        assert os.path.exists(gitignore_path), f".gitignore not found at {gitignore_path}"

    def test_gitignore_covers_logs(self):
        with open(self._gitignore_path(), "r", encoding="utf-8") as f:
            content = f.read()
        assert "logs" in content or "logs/" in content

    def test_gitignore_covers_env(self):
        with open(self._gitignore_path(), "r", encoding="utf-8") as f:
            content = f.read()
        assert ".env" in content
