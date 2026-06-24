from __future__ import annotations

"""音频语音识别处理器（对应问题 1：多模态感知）。

能力：
- 语音转文字（ASR）：支持 Whisper（本地）和 SpeechRecognition（在线 API）
- 音频格式检测与转换
- 语种自动检测（基于转写结果）

P1 设计：
- Whisper 优先（本地、离线、多语言）
- SpeechRecognition 作为降级方案（Google Web Speech API）
- 两者均不可用时返回低置信度结果
"""

import logging
import os
import tempfile
from typing import Any, Dict, Optional

from core.interfaces.perception import BasePerception

logger = logging.getLogger(__name__)

# 检测可选依赖
try:
    import whisper  # type: ignore
    _WHISPER_AVAILABLE = True
except ImportError:
    _WHISPER_AVAILABLE = False

try:
    import speech_recognition as sr  # type: ignore
    _SR_AVAILABLE = True
except ImportError:
    _SR_AVAILABLE = False

try:
    import pydub  # type: ignore
    _PYDUB_AVAILABLE = True
except ImportError:
    _PYDUB_AVAILABLE = False


class AudioProcessor(BasePerception):
    """音频语音识别处理器。

    支持的音频格式：wav, mp3, m4a, flac, ogg
    转写后输出文本，供下游 TextPreprocessor / LLMParser 进一步处理。

    优先级：
    1. Whisper（本地模型，离线，多语言支持好）
    2. SpeechRecognition（Google Web Speech API，需联网）
    3. 返回低置信度空结果
    """

    def __init__(
        self,
        whisper_model: str = "base",
        whisper_language: Optional[str] = None,
        sr_language: str = "zh-CN",
        enable_fallback: bool = True,
    ) -> None:
        """初始化音频处理器。

        Args:
            whisper_model: Whisper 模型名称（tiny/base/small/medium/large）
            whisper_language: Whisper 识别语言（None=自动检测）
            sr_language: SpeechRecognition 语言代码
            enable_fallback: Whisper 失败时是否降级到 SpeechRecognition
        """
        self._whisper_model_name = whisper_model
        self._whisper_language = whisper_language
        self._sr_language = sr_language
        self._enable_fallback = enable_fallback

        # 延迟加载 Whisper 模型
        self._whisper_model = None
        if _WHISPER_AVAILABLE:
            self._load_whisper_model()

    def _load_whisper_model(self) -> None:
        """延迟加载 Whisper 模型。"""
        try:
            self._whisper_model = whisper.load_model(self._whisper_model_name)
            logger.info("Whisper model loaded: %s", self._whisper_model_name)
        except Exception as e:
            logger.warning("Failed to load Whisper model: %s", str(e))
            self._whisper_model = None

    def perceive(
        self,
        input_type: str,
        raw_content: bytes,
        language: Optional[str] = None,
        sensitivity_level: int = 0,
    ) -> Dict[str, Any]:
        """对音频做语音识别，转写为文本。

        Args:
            input_type: 应为 "audio"
            raw_content: 音频文件的二进制数据
            language: 可选语言提示
            sensitivity_level: 敏感度级别

        Returns:
            感知结果，parsed_content.text 为转写文本
        """
        if input_type != "audio":
            return self._empty_result(input_type)

        if not raw_content:
            return self._empty_result("audio")

        result: Dict[str, Any] = {
            "parsed_content": {
                "input_type": "audio",
                "text": "",
                "asr_engine": None,
            },
            "detected_language": language,
            "confidence": 0.0,
            "metadata": {
                "audio_length": len(raw_content),
                "asr_success": False,
            },
        }

        # 将二进制数据写入临时文件
        temp_path = None
        try:
            temp_path = self._save_temp_audio(raw_content)
            if temp_path is None:
                result["parsed_content"]["error"] = "unsupported audio format"
                return result

            # 尝试 Whisper
            if self._whisper_model is not None:
                whisper_result = self._transcribe_with_whisper(temp_path, language)
                if whisper_result:
                    result["parsed_content"]["text"] = whisper_result["text"]
                    result["parsed_content"]["asr_engine"] = "whisper"
                    result["detected_language"] = whisper_result.get("language", language)
                    result["confidence"] = whisper_result["confidence"]
                    result["metadata"]["asr_success"] = True
                    result["metadata"]["asr_segments"] = whisper_result.get("segments_count", 0)
                    return result

            # 降级到 SpeechRecognition
            if self._enable_fallback and _SR_AVAILABLE:
                sr_result = self._transcribe_with_sr(temp_path)
                if sr_result:
                    result["parsed_content"]["text"] = sr_result["text"]
                    result["parsed_content"]["asr_engine"] = "speech_recognition"
                    result["confidence"] = sr_result["confidence"]
                    result["metadata"]["asr_success"] = True
                    return result

            # 全部失败
            result["parsed_content"]["error"] = "ASR failed: no engine available"
            result["confidence"] = 0.1
        finally:
            # 清理临时文件
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

        return result

    def _save_temp_audio(self, raw_content: bytes) -> Optional[str]:
        """将音频二进制数据保存为临时文件。

        自动检测音频格式（通过文件头 magic bytes）。
        """
        # 检测音频格式
        audio_format = self._detect_audio_format(raw_content)
        if audio_format is None:
            logger.warning("Unknown audio format")
            return None

        # 写入临时文件
        try:
            fd, temp_path = tempfile.mkstemp(suffix=f".{audio_format}")
            with os.fdopen(fd, "wb") as f:
                f.write(raw_content)
            return temp_path
        except OSError as e:
            logger.warning("Failed to save temp audio: %s", str(e))
            return None

    def _detect_audio_format(self, data: bytes) -> Optional[str]:
        """通过文件头 magic bytes 检测音频格式。

        支持格式：wav, mp3, m4a/aac, flac, ogg
        """
        if len(data) < 4:
            return None

        # WAV: RIFF....WAVE
        if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
            return "wav"

        # MP3: ID3 tag 或 FF FB
        if data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
            return "mp3"

        # M4A/AAC: ftyp box
        if data[4:8] == b"ftyp":
            return "m4a"

        # FLAC: fLaC
        if data[:4] == b"fLaC":
            return "flac"

        # OGG: OggS
        if data[:4] == b"OggS":
            return "ogg"

        return None

    def _transcribe_with_whisper(
        self,
        audio_path: str,
        language: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """使用 Whisper 做语音识别。

        Returns:
            {"text": str, "language": str, "confidence": float, "segments_count": int}
        """
        try:
            # 转换为 wav 格式（Whisper 需要特定采样率）
            wav_path = self._ensure_wav(audio_path)
            if wav_path is None:
                wav_path = audio_path

            lang = language or self._whisper_language
            options = {}
            if lang:
                options["language"] = lang

            transcript = self._whisper_model.transcribe(wav_path, **options)

            text = transcript.get("text", "").strip()
            if not text:
                return None

            # 从 segments 计算平均置信度
            segments = transcript.get("segments", [])
            avg_confidence = 0.7  # Whisper 默认置信度
            if segments:
                confidences = []
                for seg in segments:
                    # Whisper 不直接提供置信度，用 no_speech_prob 近似
                    no_speech = seg.get("no_speech_prob", 0.5)
                    confidences.append(1.0 - no_speech)
                if confidences:
                    avg_confidence = sum(confidences) / len(confidences)

            return {
                "text": text,
                "language": transcript.get("language", lang),
                "confidence": round(avg_confidence, 3),
                "segments_count": len(segments),
            }
        except Exception as e:
            logger.warning("Whisper transcription failed: %s", str(e))
            return None

    def _transcribe_with_sr(self, audio_path: str) -> Optional[Dict[str, Any]]:
        """使用 SpeechRecognition 做语音识别（降级方案）。

        依赖 Google Web Speech API，需联网。
        """
        try:
            recognizer = sr.Recognizer()

            # 确保是 wav 格式
            wav_path = self._ensure_wav(audio_path)
            if wav_path is None:
                wav_path = audio_path

            with sr.AudioFile(wav_path) as source:
                audio_data = recognizer.record(source)

            text = recognizer.recognize_google(audio_data, language=self._sr_language)

            if not text:
                return None

            return {
                "text": text,
                "confidence": 0.6,  # Google ASR 默认置信度
            }
        except sr.UnknownValueError:
            logger.warning("SpeechRecognition: could not understand audio")
            return None
        except sr.RequestError as e:
            logger.warning("SpeechRecognition API error: %s", str(e))
            return None
        except Exception as e:
            logger.warning("SpeechRecognition failed: %s", str(e))
            return None

    def _ensure_wav(self, audio_path: str) -> Optional[str]:
        """确保音频文件为 WAV 格式。

        若非 WAV 且 pydub 可用，则转换；否则返回 None。
        """
        if audio_path.endswith(".wav"):
            return audio_path

        if not _PYDUB_AVAILABLE:
            logger.debug("pydub not available, cannot convert audio format")
            return None

        try:
            audio = pydub.AudioSegment.from_file(audio_path)
            wav_path = audio_path.rsplit(".", 1)[0] + ".wav"
            audio.export(wav_path, format="wav")
            return wav_path
        except Exception as e:
            logger.warning("Audio conversion failed: %s", str(e))
            return None

    def _empty_result(self, input_type: str) -> Dict[str, Any]:
        return {
            "parsed_content": {"input_type": input_type, "error": "unsupported or empty input"},
            "detected_language": None,
            "confidence": 0.0,
            "metadata": {"asr_success": False},
        }
