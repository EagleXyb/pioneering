"""P3-12.3.4: 时间日期工具（纯计算，无风险）。

提供时间获取、格式化、时区转换、日期解析等能力，所有操作为纯计算，
不涉及 IO / 网络 / 文件，无需人工审批。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from core.interfaces.action import BaseTool

logger = logging.getLogger(__name__)

# 常见时区偏移（UTC 偏移小时数）
_TIMEZONE_OFFSETS: Dict[str, float] = {
    "UTC": 0.0,
    "GMT": 0.0,
    "CST": 8.0,    # China Standard Time
    "CTT": 8.0,    # China Time
    "EST": -5.0,   # Eastern Standard Time
    "PST": -8.0,   # Pacific Standard Time
    "JST": 9.0,    # Japan Standard Time
    "IST": 5.5,    # India Standard Time
    "BST": 1.0,    # British Summer Time
    "CET": 1.0,    # Central European Time
    "EET": 2.0,    # Eastern European Time
}


class DateTimeTool(BaseTool):
    """P3-12.3.4: 时间日期工具。

    支持 now / format / parse / timezone_convert 操作。
    """

    def name(self) -> str:
        return "datetime"

    def description(self) -> str:
        return (
            "时间日期工具：获取当前时间、格式化、时区转换、日期解析；"
            "支持 now/format/parse/convert 操作"
        )

    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "op": {
                    "type": "string",
                    "description": "操作类型：now/format/parse/convert",
                    "enum": ["now", "format", "parse", "convert"],
                },
                "timezone": {
                    "type": "string",
                    "description": "时区名称（CST/UTC/EST/PST/JST 等）",
                },
                "datetime_str": {
                    "type": "string",
                    "description": "parse 操作的输入时间字符串",
                },
                "format_str": {
                    "type": "string",
                    "description": "strftime 格式字符串（默认 %%Y-%%m-%%d %%H:%%M:%%S）",
                },
                "source_timezone": {
                    "type": "string",
                    "description": "convert 操作的源时区",
                },
                "target_timezone": {
                    "type": "string",
                    "description": "convert 操作的目标时区",
                },
            },
            "required": ["op"],
        }

    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        op = params.get("op", "")

        try:
            if op == "now":
                return self._now(params)
            elif op == "format":
                return self._format(params)
            elif op == "parse":
                return self._parse(params)
            elif op == "convert":
                return self._convert(params)
            else:
                return {
                    "status": "error",
                    "error_code": "DT_001",
                    "data": {"message": f"Unknown op: {op}"},
                }
        except Exception as e:
            logger.error("DateTimeTool error: %s", str(e))
            return {
                "status": "error",
                "error_code": "DT_002",
                "data": {"message": str(e)},
            }

    def _get_tz_offset(self, tz_name: str) -> Optional[timedelta]:
        """根据时区名称获取 UTC 偏移 timedelta。"""
        if not tz_name:
            return None
        offset_hours = _TIMEZONE_OFFSETS.get(tz_name.upper())
        if offset_hours is None:
            return None
        return timedelta(hours=offset_hours)

    def _now(self, params: Dict[str, Any]) -> Dict[str, Any]:
        tz_name = params.get("timezone", "UTC")
        tz_offset = self._get_tz_offset(tz_name)
        if tz_offset is None:
            return {
                "status": "error",
                "error_code": "DT_003",
                "data": {"message": f"Unknown timezone: {tz_name}"},
            }
        now = datetime.now(timezone.utc) + tz_offset
        format_str = params.get("format_str", "%Y-%m-%d %H:%M:%S")
        return {
            "status": "success",
            "error_code": "",
            "data": {
                "datetime": now.strftime(format_str),
                "iso": now.replace(tzinfo=None).isoformat(),
                "timezone": tz_name,
                "unix_timestamp": int(now.timestamp()),
            },
        }

    def _format(self, params: Dict[str, Any]) -> Dict[str, Any]:
        datetime_str = params.get("datetime_str", "")
        format_str = params.get("format_str", "%Y-%m-%d %H:%M:%S")
        if not datetime_str:
            return {
                "status": "error",
                "error_code": "DT_004",
                "data": {"message": "datetime_str is required for format op"},
            }
        # 尝试 ISO 解析输入
        try:
            dt = datetime.fromisoformat(datetime_str)
        except ValueError:
            # 尝试常见格式
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(datetime_str, fmt)
                    break
                except ValueError:
                    continue
            else:
                return {
                    "status": "error",
                    "error_code": "DT_005",
                    "data": {"message": f"Cannot parse datetime: {datetime_str}"},
                }
        return {
            "status": "success",
            "error_code": "",
            "data": {
                "formatted": dt.strftime(format_str),
                "iso": dt.isoformat(),
            },
        }

    def _parse(self, params: Dict[str, Any]) -> Dict[str, Any]:
        datetime_str = params.get("datetime_str", "")
        if not datetime_str:
            return {
                "status": "error",
                "error_code": "DT_004",
                "data": {"message": "datetime_str is required for parse op"},
            }
        # 尝试 ISO 解析
        try:
            dt = datetime.fromisoformat(datetime_str)
            return {
                "status": "success",
                "error_code": "",
                "data": {
                    "iso": dt.isoformat(),
                    "year": dt.year,
                    "month": dt.month,
                    "day": dt.day,
                    "hour": dt.hour,
                    "minute": dt.minute,
                    "second": dt.second,
                    "weekday": dt.strftime("%A"),
                    "unix_timestamp": int(dt.timestamp()),
                },
            }
        except ValueError as e:
            return {
                "status": "error",
                "error_code": "DT_005",
                "data": {"message": f"Cannot parse datetime: {e}"},
            }

    def _convert(self, params: Dict[str, Any]) -> Dict[str, Any]:
        datetime_str = params.get("datetime_str", "")
        src_tz = params.get("source_timezone", "UTC")
        tgt_tz = params.get("target_timezone", "UTC")
        format_str = params.get("format_str", "%Y-%m-%d %H:%M:%S")

        if not datetime_str:
            return {
                "status": "error",
                "error_code": "DT_004",
                "data": {"message": "datetime_str is required for convert op"},
            }

        src_offset = self._get_tz_offset(src_tz)
        tgt_offset = self._get_tz_offset(tgt_tz)
        if src_offset is None:
            return {
                "status": "error",
                "error_code": "DT_003",
                "data": {"message": f"Unknown source timezone: {src_tz}"},
            }
        if tgt_offset is None:
            return {
                "status": "error",
                "error_code": "DT_003",
                "data": {"message": f"Unknown target timezone: {tgt_tz}"},
            }

        # 解析输入时间（视为源时区本地时间）
        try:
            dt = datetime.fromisoformat(datetime_str)
        except ValueError:
            try:
                dt = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
            except ValueError as e:
                return {
                    "status": "error",
                    "error_code": "DT_005",
                    "data": {"message": f"Cannot parse datetime: {e}"},
                }

        # 转换：源时区 → UTC → 目标时区
        utc_dt = dt - src_offset
        tgt_dt = utc_dt + tgt_offset

        return {
            "status": "success",
            "error_code": "",
            "data": {
                "source_datetime": dt.strftime(format_str),
                "source_timezone": src_tz,
                "target_datetime": tgt_dt.strftime(format_str),
                "target_timezone": tgt_tz,
                "offset_diff_hours": (tgt_offset - src_offset).total_seconds() / 3600,
            },
        }
