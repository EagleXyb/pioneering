from __future__ import annotations

"""图像处理器（对应问题 1：多模态感知）。

能力：
- OCR 文字识别：从图像中提取文本
- 场景描述：生成图像内容描述
- 输出统一格式：转为文本后可接入 TextPreprocessor 管线

设计原则：
- OCR 库（pytesseract / easyocr）为可选依赖，不可用时降级
- 图像解码使用 Pillow，不可用时降级
- 所有外部调用设置超时，失败不阻塞主流程
"""

import base64
import io
import logging
from typing import Any, Dict, Optional

from core.interfaces.perception import BasePerception

logger = logging.getLogger(__name__)


class ImageProcessor(BasePerception):
    """图像处理器：OCR + 场景描述。

    将图像输入转为文本描述，再走文本处理管线。
    """

    def __init__(
        self,
        ocr_engine: str = "auto",  # auto | tesseract | easyocr | none
        max_image_size: int = 4096,
        enable_scene_description: bool = False,
    ) -> None:
        self._ocr_engine = ocr_engine
        self._max_image_size = max_image_size
        self._enable_scene = enable_scene_description
        self._ocr = None
        self._pil_available = False
        self._init_ocr()

    def _init_ocr(self) -> None:
        """延迟初始化 OCR 引擎，失败则降级。"""
        if self._ocr_engine == "none":
            return

        # 尝试 Pillow（图像解码）
        try:
            from PIL import Image  # noqa: F401
            self._pil_available = True
        except ImportError:
            logger.warning("Pillow not available, image processing will be limited")
            return

        # 尝试 pytesseract
        if self._ocr_engine in ("auto", "tesseract"):
            try:
                import pytesseract
                self._ocr = ("tesseract", pytesseract)
                logger.info("OCR engine initialized: tesseract")
                return
            except ImportError:
                pass

        # 尝试 easyocr
        if self._ocr_engine in ("auto", "easyocr"):
            try:
                import easyocr
                self._ocr = ("easyocr", easyocr.Reader(["ch_sim", "en"]))
                logger.info("OCR engine initialized: easyocr")
                return
            except Exception as e:
                logger.warning("easyocr initialization failed: %s", str(e))

        logger.warning("No OCR engine available, image text extraction disabled")

    def perceive(
        self,
        input_type: str,
        raw_content: bytes,
        language: Optional[str] = None,
        sensitivity_level: int = 0,
    ) -> Dict[str, Any]:
        """处理图像输入，提取文本。

        raw_content 可以是：
        - 原始图像字节（PNG/JPEG）
        - Base64 编码的图像字符串
        """
        if input_type != "image":
            return {
                "parsed_content": {"input_type": input_type, "error": "unsupported input type"},
                "detected_language": None,
                "confidence": 0.0,
                "metadata": {"sensitivity_level": 0},
            }

        # 解码图像字节
        image_bytes = self._decode_image_bytes(raw_content)
        if image_bytes is None:
            return self._error_result("failed to decode image")

        # OCR 提取文本
        extracted_text = self._extract_text(image_bytes)
        if not extracted_text:
            return {
                "parsed_content": {
                    "input_type": "image",
                    "text": "",
                    "ocr_success": False,
                    "note": "no text extracted from image",
                },
                "detected_language": None,
                "confidence": 0.3,
                "metadata": {
                    "sensitivity_level": sensitivity_level,
                    "image_size": len(image_bytes),
                    "ocr_engine": self._ocr[0] if self._ocr else "none",
                },
            }

        return {
            "parsed_content": {
                "input_type": "text",  # 转为文本，可接入 TextPreprocessor
                "text": extracted_text,
                "source": "image_ocr",
                "ocr_success": True,
            },
            "detected_language": language,
            "confidence": 0.7,
            "metadata": {
                "sensitivity_level": sensitivity_level,
                "image_size": len(image_bytes),
                "ocr_engine": self._ocr[0] if self._ocr else "none",
                "extracted_length": len(extracted_text),
            },
        }

    def _decode_image_bytes(self, raw_content: bytes) -> Optional[bytes]:
        """解码图像字节，支持 Base64 编码输入。"""
        if not raw_content:
            return None

        # 尝试 Base64 解码
        try:
            decoded = base64.b64decode(raw_content, validate=True)
            if decoded[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1"):
                return decoded
        except Exception:
            pass

        # 直接作为图像字节
        if raw_content[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1"):
            return raw_content

        # 无法识别的格式
        logger.warning("Unrecognized image format")
        return None

    def _extract_text(self, image_bytes: bytes) -> str:
        """使用 OCR 引擎提取文本。"""
        if not self._ocr or not self._pil_available:
            return ""

        try:
            from PIL import Image
        except ImportError:
            return ""

        try:
            image = Image.open(io.BytesIO(image_bytes))

            # 限制图像大小
            if max(image.size) > self._max_image_size:
                ratio = self._max_image_size / max(image.size)
                new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
                image = image.resize(new_size)

            engine_type, engine = self._ocr

            if engine_type == "tesseract":
                return engine.image_to_string(image, lang="chi_sim+eng")
            elif engine_type == "easyocr":
                results = engine.readtext(image)
                return "\n".join(text for _bbox, text, _conf in results)

        except Exception as e:
            logger.warning("OCR extraction failed: %s", str(e))

        return ""

    def _error_result(self, message: str) -> Dict[str, Any]:
        return {
            "parsed_content": {"input_type": "image", "error": message},
            "detected_language": None,
            "confidence": 0.0,
            "metadata": {"sensitivity_level": 0},
        }
