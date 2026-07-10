// 对应 Python: components/perception/audio/asr_processor.py
// 音频语音识别处理器（对应问题 1：多模态感知）
//
// 能力：
// - 语音转文字（ASR）：支持 Whisper（本地）和 SpeechRecognition（在线 API）
// - 音频格式检测与转换
// - 语种自动检测（基于转写结果）
//
// P1 设计：
// - Whisper 优先（本地、离线、多语言）
// - SpeechRecognition 作为降级方案（Google Web Speech API）
// - 两者均不可用时返回低置信度结果
//
// 注：TS 版无 whisper / speech_recognition / pydub 等价库，
// ASR 功能需通过外部 API（如 OpenAI Whisper API）接入。
// 保留接口等价，实现标注为 TODO，不可用时返回低置信度空结果。
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { BasePerception } from '../../core/interfaces/perception.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[asr] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[asr] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[asr] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[asr] ${msg}`, ...args),
}

// 检测可选依赖（TS 版均不可用）
const _WHISPER_AVAILABLE = false
const _SR_AVAILABLE = false
const _PYDUB_AVAILABLE = false

/**
 * 音频语音识别处理器。
 * 对应 Python AudioProcessor。
 *
 * 支持的音频格式：wav, mp3, m4a, flac, ogg
 * 转写后输出文本，供下游 TextPreprocessor / LLMParser 进一步处理。
 *
 * 优先级：
 * 1. Whisper（本地模型，离线，多语言支持好）
 * 2. SpeechRecognition（Google Web Speech API，需联网）
 * 3. 返回低置信度空结果
 *
 * 注：TS 版 Whisper / SpeechRecognition 不可用，默认返回低置信度空结果。
 * 可通过子类覆写 _transcribeWithWhisper / _transcribeWithSr 接入外部 ASR API。
 */
export class AudioProcessor extends BasePerception {
  protected _whisperModelName: string
  protected _whisperLanguage: string | null
  protected _srLanguage: string
  protected _enableFallback: boolean
  protected _whisperModel: any = null

  constructor(
    whisperModel: string = 'base',
    whisperLanguage?: string | null,
    srLanguage: string = 'zh-CN',
    enableFallback: boolean = true,
  ) {
    super()
    this._whisperModelName = whisperModel
    this._whisperLanguage = whisperLanguage ?? null
    this._srLanguage = srLanguage
    this._enableFallback = enableFallback

    // 延迟加载 Whisper 模型
    if (_WHISPER_AVAILABLE) {
      this._loadWhisperModel()
    }
  }

  /** 延迟加载 Whisper 模型（TS 版不可用）。 */
  protected _loadWhisperModel(): void {
    // TODO: TS 版无 whisper 等价库，可通过 OpenAI Whisper API 接入
    logger.warning('Whisper not available in TS runtime')
    this._whisperModel = null
  }

  /**
   * 对音频做语音识别，转写为文本。
   * 对应 Python perceive。
   */
  async perceive(
    inputType: string,
    rawContent: Uint8Array,
    language?: string | null,
    _sensitivityLevel: number = 0,
  ): Promise<Record<string, any>> {
    if (inputType !== 'audio') {
      return this._emptyResult(inputType)
    }

    if (!rawContent || rawContent.length === 0) {
      return this._emptyResult('audio')
    }

    const result: Record<string, any> = {
      parsed_content: {
        input_type: 'audio',
        text: '',
        asr_engine: null,
      },
      detected_language: language,
      confidence: 0.0,
      metadata: {
        audio_length: rawContent.length,
        asr_success: false,
      },
    }

    // 将二进制数据写入临时文件
    let tempPath: string | null = null
    try {
      tempPath = this._saveTempAudio(rawContent)
      if (tempPath === null) {
        result['parsed_content']['error'] = 'unsupported audio format'
        return result
      }

      // 尝试 Whisper
      if (this._whisperModel !== null) {
        const whisperResult = await this._transcribeWithWhisper(tempPath, language)
        if (whisperResult) {
          result['parsed_content']['text'] = whisperResult.text
          result['parsed_content']['asr_engine'] = 'whisper'
          result['detected_language'] = whisperResult.language ?? language
          result['confidence'] = whisperResult.confidence
          result['metadata']['asr_success'] = true
          result['metadata']['asr_segments'] = whisperResult.segments_count ?? 0
          return result
        }
      }

      // 降级到 SpeechRecognition
      if (this._enableFallback && _SR_AVAILABLE) {
        const srResult = await this._transcribeWithSr(tempPath)
        if (srResult) {
          result['parsed_content']['text'] = srResult.text
          result['parsed_content']['asr_engine'] = 'speech_recognition'
          result['confidence'] = srResult.confidence
          result['metadata']['asr_success'] = true
          return result
        }
      }

      // 全部失败
      result['parsed_content']['error'] = 'ASR failed: no engine available'
      result['confidence'] = 0.1
    } finally {
      // 清理临时文件
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath)
        } catch {
          // 忽略清理失败
        }
      }
    }

    return result
  }

  /** 将音频二进制数据保存为临时文件。 */
  private _saveTempAudio(rawContent: Uint8Array): string | null {
    // 检测音频格式
    const audioFormat = this._detectAudioFormat(rawContent)
    if (audioFormat === null) {
      logger.warning('Unknown audio format')
      return null
    }

    // 写入临时文件
    try {
      const tempPath = path.join(os.tmpdir(), `modu_audio_${Date.now()}_${Math.random().toString(36).slice(2)}.${audioFormat}`)
      fs.writeFileSync(tempPath, rawContent)
      return tempPath
    } catch (e) {
      logger.warning('Failed to save temp audio: %s', String(e))
      return null
    }
  }

  /**
   * 通过文件头 magic bytes 检测音频格式。
   * 对应 Python _detect_audio_format。
   */
  private _detectAudioFormat(data: Uint8Array): string | null {
    if (data.length < 4) {
      return null
    }

    // WAV: RIFF....WAVE
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
        data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45) {
      return 'wav'
    }

    // MP3: ID3 tag 或 FF FB
    if ((data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) ||
        (data[0] === 0xFF && (data[1] & 0xE0) === 0xE0)) {
      return 'mp3'
    }

    // M4A/AAC: ftyp box
    if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
      return 'm4a'
    }

    // FLAC: fLaC
    if (data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) {
      return 'flac'
    }

    // OGG: OggS
    if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
      return 'ogg'
    }

    return null
  }

  /**
   * 使用 Whisper 做语音识别。
   * 对应 Python _transcribe_with_whisper。
   *
   * TS 版 Whisper 不可用，始终返回 null。
   * 子类可覆写此方法接入 OpenAI Whisper API。
   */
  protected async _transcribeWithWhisper(
    _audioPath: string,
    _language?: string | null,
  ): Promise<Record<string, any> | null> {
    // TODO: 接入 OpenAI Whisper API 或其他 ASR 服务
    return null
  }

  /**
   * 使用 SpeechRecognition 做语音识别（降级方案）。
   * 对应 Python _transcribe_with_sr。
   *
   * TS 版 SpeechRecognition 不可用，始终返回 null。
   */
  protected async _transcribeWithSr(_audioPath: string): Promise<Record<string, any> | null> {
    // TODO: 接入 Google Web Speech API 或其他在线 ASR 服务
    return null
  }

  /**
   * 确保音频文件为 WAV 格式。
   * 对应 Python _ensure_wav。
   *
   * TS 版 pydub 不可用，非 WAV 文件返回 null。
   */
  protected _ensureWav(audioPath: string): string | null {
    if (audioPath.endsWith('.wav')) {
      return audioPath
    }

    if (!_PYDUB_AVAILABLE) {
      logger.debug('pydub not available, cannot convert audio format')
      return null
    }

    // TODO: 接入 ffmpeg 等音频转换工具
    return null
  }

  private _emptyResult(inputType: string): Record<string, any> {
    return {
      parsed_content: { input_type: inputType, error: 'unsupported or empty input' },
      detected_language: null,
      confidence: 0.0,
      metadata: { asr_success: false },
    }
  }
}
