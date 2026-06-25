from __future__ import annotations

"""摄像头传感器（对应问题 8：BaseSensor 接口集成）。

能力：
- 基于 OpenCV 的实时帧捕获
- 捕获结果通过 EventBus 发布
- 可对接 ImageProcessor 做进一步处理

设计原则：
- OpenCV 为可选依赖，不可用时降级
- 支持配置采集间隔、分辨率
- 线程安全，可被 Coordinator 异步管理
"""

import logging
import time
from typing import Any, Dict, Optional

from core.interfaces.perception import BaseSensor

logger = logging.getLogger(__name__)


class CameraSensor(BaseSensor):
    """摄像头传感器：定时捕获帧。

    使用 OpenCV 的 VideoCapture 进行帧捕获。
    若 OpenCV 不可用，传感器标记为不可用状态。
    """

    def __init__(
        self,
        device_index: int = 0,
        capture_interval: float = 1.0,
        resolution: Optional[tuple] = None,  # (width, height)
    ) -> None:
        self._device_index = device_index
        self._capture_interval = capture_interval
        self._resolution = resolution
        self._cap = None
        self._available = False
        self._init_camera()

    def _init_camera(self) -> None:
        """延迟初始化摄像头。"""
        try:
            import cv2
            self._cap = cv2.VideoCapture(self._device_index)
            if self._cap.isOpened():
                if self._resolution:
                    self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._resolution[0])
                    self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._resolution[1])
                self._available = True
                logger.info("Camera sensor initialized: device=%d", self._device_index)
            else:
                logger.warning("Camera device %d not available", self._device_index)
                self._available = False
        except ImportError:
            logger.warning("OpenCV not available, camera sensor disabled")
            self._available = False
        except Exception as e:
            logger.warning("Camera initialization failed: %s", str(e))
            self._available = False

    def sensor_type(self) -> str:
        return "camera"

    def is_available(self) -> bool:
        """检查摄像头是否可用。"""
        return self._available

    def capture(self, context: Dict[str, Any]) -> bytes:
        """捕获一帧图像。

        Returns:
            JPEG 编码的图像字节；若不可用返回空字节。
        """
        if not self._available or self._cap is None:
            return b""

        try:
            import cv2

            ret, frame = self._cap.read()
            if not ret or frame is None:
                logger.warning("Camera capture failed: no frame")
                return b""

            # 编码为 JPEG
            _ret, encoded = cv2.imencode(".jpg", frame)
            if _ret:
                return encoded.tobytes()

        except Exception as e:
            logger.warning("Camera capture error: %s", str(e))

        return b""

    def release(self) -> None:
        """释放摄像头资源。"""
        if self._cap is not None:
            try:
                self._cap.release()
                logger.info("Camera sensor released")
            except Exception as e:
                logger.warning("Camera release failed: %s", str(e))
            finally:
                self._cap = None
                self._available = False


class TimerSensor(BaseSensor):
    """定时传感器：按固定间隔触发事件。

    用于定时采集场景（如定时查询数据库、定时检查系统状态）。
    """

    def __init__(self, interval: float = 60.0) -> None:
        self._interval = interval
        self._last_trigger = 0.0

    def sensor_type(self) -> str:
        return "timer"

    def capture(self, context: Dict[str, Any]) -> bytes:
        """返回当前时间戳作为触发信号。"""
        now = time.time()
        if now - self._last_trigger >= self._interval:
            self._last_trigger = now
            return str(now).encode("utf-8")
        return b""


class MicrophoneSensor(BaseSensor):
    """麦克风传感器：定时采集音频片段（对应问题 8：BaseSensor 接口集成）。

    P1 新增：
    - 基于 PyAudio 的实时音频采集
    - 采集结果为 WAV 格式字节，可通过 EventBus 发布
    - 可对接 AudioProcessor 做进一步 ASR 处理

    设计原则：
    - PyAudio 为可选依赖，不可用时降级
    - 支持配置采集时长、采样率、声道数
    - 线程安全，可被 Coordinator 异步管理
    """

    def __init__(
        self,
        device_index: Optional[int] = None,
        duration: float = 5.0,
        sample_rate: int = 16000,
        channels: int = 1,
        chunk_size: int = 1024,
    ) -> None:
        """初始化麦克风传感器。

        Args:
            device_index: 音频设备索引（None=默认设备）
            duration: 每次采集的时长（秒）
            sample_rate: 采样率（Whisper 推荐 16000Hz）
            channels: 声道数（1=单声道，2=立体声）
            chunk_size: PyAudio 缓冲区大小
        """
        self._device_index = device_index
        self._duration = duration
        self._sample_rate = sample_rate
        self._channels = channels
        self._chunk_size = chunk_size
        self._pyaudio = None
        self._available = False
        self._init_microphone()

    def _init_microphone(self) -> None:
        """延迟初始化麦克风。"""
        try:
            import pyaudio
            self._pyaudio = pyaudio.PyAudio()
            # 检查设备可用性
            device_count = self._pyaudio.get_device_count()
            if device_count > 0:
                self._available = True
                logger.info(
                    "Microphone sensor initialized: %d devices, rate=%d, channels=%d",
                    device_count, self._sample_rate, self._channels,
                )
            else:
                logger.warning("No audio devices available")
                self._available = False
        except ImportError:
            logger.warning("PyAudio not available, microphone sensor disabled")
            self._available = False
        except Exception as e:
            logger.warning("Microphone initialization failed: %s", str(e))
            self._available = False

    def sensor_type(self) -> str:
        return "microphone"

    def is_available(self) -> bool:
        """检查麦克风是否可用。"""
        return self._available

    def capture(self, context: Dict[str, Any]) -> bytes:
        """采集一段音频。

        Returns:
            WAV 格式的音频字节；若不可用返回空字节。
        """
        if not self._available or self._pyaudio is None:
            return b""

        try:
            import pyaudio
            import struct
            import wave
            import io

            # 打开音频流
            stream = self._pyaudio.open(
                format=pyaudio.paInt16,
                channels=self._channels,
                rate=self._sample_rate,
                input=True,
                input_device_index=self._device_index,
                frames_per_buffer=self._chunk_size,
            )

            frames = []
            num_chunks = int(self._sample_rate / self._chunk_size * self._duration)
            for _ in range(num_chunks):
                data = stream.read(self._chunk_size, exception_on_overflow=False)
                frames.append(data)

            stream.stop_stream()
            stream.close()

            # 将 PCM 数据转换为 WAV 格式字节
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, "wb") as wav_file:
                wav_file.setnchannels(self._channels)
                wav_file.setsampwidth(self._pyaudio.get_sample_size(pyaudio.paInt16))
                wav_file.setframerate(self._sample_rate)
                wav_file.writeframes(b"".join(frames))

            return wav_buffer.getvalue()

        except Exception as e:
            logger.warning("Microphone capture error: %s", str(e))
            return b""

    def release(self) -> None:
        """释放麦克风资源。"""
        if self._pyaudio is not None:
            try:
                self._pyaudio.terminate()
                logger.info("Microphone sensor released")
            except Exception as e:
                logger.warning("Microphone release failed: %s", str(e))
            finally:
                self._pyaudio = None
                self._available = False
