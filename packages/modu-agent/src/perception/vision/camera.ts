// 对应 Python: components/perception/vision/camera.py
// 摄像头传感器（对应问题 8：BaseSensor 接口集成）
//
// 能力：
// - 基于 OpenCV 的实时帧捕获
// - 捕获结果通过 EventBus 发布
// - 可对接 ImageProcessor 做进一步处理
//
// 设计原则：
// - OpenCV 为可选依赖，不可用时降级
// - 支持配置采集间隔、分辨率
// - 线程安全，可被 Coordinator 异步管理
//
// 注：TS 版无 OpenCV (cv2) 等价库，CameraSensor 始终处于不可用状态。
//   TimerSensor 不依赖外部库，功能完整。
//   MicrophoneSensor 无 PyAudio 等价库，始终处于不可用状态。
import { BaseSensor } from '../../core/interfaces/perception.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[camera] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[camera] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[camera] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[camera] ${msg}`, ...args),
}

// P1: 检测可选依赖可用性
// TS 版无 OpenCV (cv2) 等价库
const _CV2_AVAILABLE = false
// TS 版无 PyAudio 等价库
const _PYAUDIO_AVAILABLE = false

/**
 * 摄像头传感器：定时捕获帧。
 *
 * 使用 OpenCV 的 VideoCapture 进行帧捕获。
 * 若 OpenCV 不可用，传感器标记为不可用状态。
 *
 * 注：TS 版 OpenCV 不可用，传感器始终为不可用状态。
 */
export class CameraSensor extends BaseSensor {
  private _deviceIndex: number
  private _captureInterval: number
  private _resolution: [number, number] | null
  private _cap: any
  private _available: boolean

  constructor(
    deviceIndex: number = 0,
    captureInterval: number = 1.0,
    resolution?: [number, number] | null,
  ) {
    super()
    this._deviceIndex = deviceIndex
    this._captureInterval = captureInterval
    this._resolution = resolution ?? null
    this._cap = null
    this._available = false
    this._initCamera()
  }

  /** 延迟初始化摄像头。 */
  private _initCamera(): void {
    try {
      if (!_CV2_AVAILABLE) {
        throw new Error('OpenCV not available')
      }
      // TODO: TS 版无 OpenCV 等价库，摄像头传感器始终不可用
    } catch (e) {
      const msg = String(e)
      if (msg.includes('not available')) {
        logger.warning('OpenCV not available, camera sensor disabled')
      } else {
        logger.warning('Camera initialization failed: %s', msg)
      }
      this._available = false
    }
  }

  sensorType(): string {
    return 'camera'
  }

  /** 检查摄像头是否可用。 */
  isAvailable(): boolean {
    return this._available
  }

  /**
   * 捕获一帧图像。
   *
   * Returns:
   *     JPEG 编码的图像字节；若不可用返回空字节。
   */
  capture(_context: Record<string, any>): Uint8Array {
    if (!this._available || this._cap === null) {
      return new Uint8Array(0)
    }

    // TODO: TS 版无 OpenCV 等价库，无法捕获帧
    // Python 实现：
    //   ret, frame = this._cap.read()
    //   _ret, encoded = cv2.imencode(".jpg", frame)
    //   return encoded.tobytes()

    return new Uint8Array(0)
  }

  /** 释放摄像头资源。 */
  release(): void {
    if (this._cap !== null) {
      try {
        // this._cap.release()
        logger.info('Camera sensor released')
      } catch (e) {
        logger.warning('Camera release failed: %s', String(e))
      } finally {
        this._cap = null
        this._available = false
      }
    }
  }
}

/**
 * 定时传感器：按固定间隔触发事件。
 *
 * 用于定时采集场景（如定时查询数据库、定时检查系统状态）。
 */
export class TimerSensor extends BaseSensor {
  private _interval: number
  private _lastTrigger: number

  constructor(interval: number = 60.0) {
    super()
    this._interval = interval
    this._lastTrigger = 0.0
  }

  sensorType(): string {
    return 'timer'
  }

  /** 返回当前时间戳作为触发信号。 */
  capture(_context: Record<string, any>): Uint8Array {
    const now = Date.now() / 1000.0
    if (now - this._lastTrigger >= this._interval) {
      this._lastTrigger = now
      return new TextEncoder().encode(String(now))
    }
    return new Uint8Array(0)
  }
}

/**
 * 麦克风传感器：定时采集音频片段（对应问题 8：BaseSensor 接口集成）。
 *
 * P1 新增：
 * - 基于 PyAudio 的实时音频采集
 * - 采集结果为 WAV 格式字节，可通过 EventBus 发布
 * - 可对接 AudioProcessor 做进一步 ASR 处理
 *
 * 设计原则：
 * - PyAudio 为可选依赖，不可用时降级
 * - 支持配置采集时长、采样率、声道数
 * - 线程安全，可被 Coordinator 异步管理
 *
 * 注：TS 版 PyAudio 不可用，传感器始终为不可用状态。
 */
export class MicrophoneSensor extends BaseSensor {
  private _deviceIndex: number | null
  private _duration: number
  private _sampleRate: number
  private _channels: number
  private _chunkSize: number
  private _pyaudio: any
  private _available: boolean

  /**
   * 初始化麦克风传感器。
   *
   * Args:
   *     deviceIndex: 音频设备索引（null=默认设备）
   *     duration: 每次采集的时长（秒）
   *     sampleRate: 采样率（Whisper 推荐 16000Hz）
   *     channels: 声道数（1=单声道，2=立体声）
   *     chunkSize: PyAudio 缓冲区大小
   */
  constructor(
    deviceIndex?: number | null,
    duration: number = 5.0,
    sampleRate: number = 16000,
    channels: number = 1,
    chunkSize: number = 1024,
  ) {
    super()
    this._deviceIndex = deviceIndex ?? null
    this._duration = duration
    this._sampleRate = sampleRate
    this._channels = channels
    this._chunkSize = chunkSize
    this._pyaudio = null
    this._available = false
    this._initMicrophone()
  }

  /** 延迟初始化麦克风。 */
  private _initMicrophone(): void {
    try {
      if (!_PYAUDIO_AVAILABLE) {
        throw new Error('PyAudio not available')
      }
      // TODO: TS 版无 PyAudio 等价库，麦克风传感器始终不可用
    } catch (e) {
      const msg = String(e)
      if (msg.includes('not available')) {
        logger.warning('PyAudio not available, microphone sensor disabled')
      } else {
        logger.warning('Microphone initialization failed: %s', msg)
      }
      this._available = false
    }
  }

  sensorType(): string {
    return 'microphone'
  }

  /** 检查麦克风是否可用。 */
  isAvailable(): boolean {
    return this._available
  }

  /**
   * 采集一段音频。
   *
   * Returns:
   *     WAV 格式的音频字节；若不可用返回空字节。
   */
  capture(_context: Record<string, any>): Uint8Array {
    if (!this._available || this._pyaudio === null) {
      return new Uint8Array(0)
    }

    // TODO: TS 版无 PyAudio 等价库，无法采集音频
    // Python 实现：
    //   stream = this._pyaudio.open(format=paInt16, channels, rate, input=True, ...)
    //   frames = [stream.read(chunk_size) for _ in range(num_chunks)]
    //   wav_buffer = io.BytesIO()
    //   with wave.open(wav_buffer, "wb") as wav_file: ...
    //   return wav_buffer.getvalue()

    return new Uint8Array(0)
  }

  /** 释放麦克风资源。 */
  release(): void {
    if (this._pyaudio !== null) {
      try {
        // this._pyaudio.terminate()
        logger.info('Microphone sensor released')
      } catch (e) {
        logger.warning('Microphone release failed: %s', String(e))
      } finally {
        this._pyaudio = null
        this._available = false
      }
    }
  }
}
