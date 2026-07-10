// 对应 Python: components/perception/vision/image_processor.py
// 图像处理器（对应问题 1：多模态感知）
//
// 能力：
// - OCR 文字识别：从图像中提取文本
// - 场景描述：生成图像内容描述
// - 输出统一格式：转为文本后可接入 TextPreprocessor 管线
//
// 设计原则：
// - OCR 库（pytesseract / easyocr）为可选依赖，不可用时降级
// - 图像解码使用 Pillow，不可用时降级
// - 所有外部调用设置超时，失败不阻塞主流程
//
// 注：TS 版无 Pillow / pytesseract / easyocr 等价库（未在 dependencies 中），
//   OCR 文字提取始终返回空字符串。Base64 解码和图像格式识别逻辑完整保留。
import { BasePerception } from '../../core/interfaces/perception.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[image-processor] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[image-processor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[image-processor] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[image-processor] ${msg}`, ...args),
}

// P1: 检测可选依赖可用性
// TS 版无 Pillow 等价库
const _PIL_AVAILABLE = false
// TS 版无 pytesseract 等价库
const _PYTESSERACT_AVAILABLE = false
// TS 版无 easyocr 等价库
const _EASYOCR_AVAILABLE = false

/**
 * 图像处理器：OCR + 场景描述。
 *
 * 将图像输入转为文本描述，再走文本处理管线。
 *
 * 注：TS 版 OCR 引擎不可用，_extract_text 始终返回空字符串。
 *   可通过引入 tesseract.js 或调用云端 OCR API 来补充。
 */
export class ImageProcessor extends BasePerception {
  private _ocrEngine: string
  private _maxImageSize: number
  private _enableScene: boolean
  private _ocr: [string, any] | null
  private _pilAvailable: boolean

  constructor(
    ocrEngine: string = 'auto',  // auto | tesseract | easyocr | none
    maxImageSize: number = 4096,
    enableSceneDescription: boolean = false,
  ) {
    super()
    this._ocrEngine = ocrEngine
    this._maxImageSize = maxImageSize
    this._enableScene = enableSceneDescription
    this._ocr = null
    this._pilAvailable = false
    this._initOcr()
  }

  /** 延迟初始化 OCR 引擎，失败则降级。 */
  private _initOcr(): void {
    if (this._ocrEngine === 'none') {
      return
    }

    // 尝试 Pillow（图像解码）
    if (!_PIL_AVAILABLE) {
      logger.warning('Pillow not available, image processing will be limited')
      return
    }
    this._pilAvailable = true

    // 尝试 pytesseract
    if (this._ocrEngine === 'auto' || this._ocrEngine === 'tesseract') {
      if (_PYTESSERACT_AVAILABLE) {
        // TODO: TS 版无 pytesseract 等价库，可考虑引入 tesseract.js
        this._ocr = ['tesseract', null]
        logger.info('OCR engine initialized: tesseract')
        return
      }
    }

    // 尝试 easyocr
    if (this._ocrEngine === 'auto' || this._ocrEngine === 'easyocr') {
      if (_EASYOCR_AVAILABLE) {
        // TODO: TS 版无 easyocr 等价库
        this._ocr = ['easyocr', null]
        logger.info('OCR engine initialized: easyocr')
        return
      } else {
        logger.warning('easyocr initialization failed: not available')
      }
    }

    logger.warning('No OCR engine available, image text extraction disabled')
  }

  /**
   * 处理图像输入，提取文本。
   *
   * rawContent 可以是：
   * - 原始图像字节（PNG/JPEG）
   * - Base64 编码的图像字符串
   */
  perceive(
    inputType: string,
    rawContent: Uint8Array,
    language?: string | null,
    sensitivityLevel: number = 0,
  ): Record<string, any> {
    if (inputType !== 'image') {
      return {
        parsed_content: { input_type: inputType, error: 'unsupported input type' },
        detected_language: null,
        confidence: 0.0,
        metadata: { sensitivity_level: 0 },
      }
    }

    // 解码图像字节
    const imageBytes = this._decodeImageBytes(rawContent)
    if (imageBytes === null) {
      return this._errorResult('failed to decode image')
    }

    // OCR 提取文本
    const extractedText = this._extractText(imageBytes)
    if (!extractedText) {
      return {
        parsed_content: {
          input_type: 'image',
          text: '',
          ocr_success: false,
          note: 'no text extracted from image',
        },
        detected_language: null,
        confidence: 0.3,
        metadata: {
          sensitivity_level: sensitivityLevel,
          image_size: imageBytes.length,
          ocr_engine: this._ocr ? this._ocr[0] : 'none',
        },
      }
    }

    return {
      parsed_content: {
        input_type: 'text',  // 转为文本，可接入 TextPreprocessor
        text: extractedText,
        source: 'image_ocr',
        ocr_success: true,
      },
      detected_language: language ?? null,
      confidence: 0.7,
      metadata: {
        sensitivity_level: sensitivityLevel,
        image_size: imageBytes.length,
        ocr_engine: this._ocr ? this._ocr[0] : 'none',
        extracted_length: extractedText.length,
      },
    }
  }

  /** 解码图像字节，支持 Base64 编码输入。 */
  private _decodeImageBytes(rawContent: Uint8Array): Uint8Array | null {
    if (!rawContent || rawContent.length === 0) {
      return null
    }

    // 尝试 Base64 解码
    try {
      const decoder = new TextDecoder('ascii')
      const str = decoder.decode(rawContent)
      // 验证是否为合法 Base64
      if (/^[A-Za-z0-9+/]*={0,2}$/.test(str) && str.length > 0) {
        const decoded = _base64Decode(str)
        if (decoded && _isImageMagicBytes(decoded)) {
          return decoded
        }
      }
    } catch {
      // 继续
    }

    // 直接作为图像字节
    if (_isImageMagicBytes(rawContent)) {
      return rawContent
    }

    // 无法识别的格式
    logger.warning('Unrecognized image format')
    return null
  }

  /** 使用 OCR 引擎提取文本。 */
  private _extractText(imageBytes: Uint8Array): string {
    if (!this._ocr || !this._pilAvailable) {
      return ''
    }

    // TODO: TS 版无 Pillow / pytesseract / easyocr 等价库
    // Python 实现：
    //   image = Image.open(io.BytesIO(imageBytes))
    //   if max(image.size) > self._max_image_size:
    //       ratio = self._max_image_size / max(image.size)
    //       image = image.resize(...)
    //   if engine_type == "tesseract":
    //       return engine.image_to_string(image, lang="chi_sim+eng")
    //   elif engine_type == "easyocr":
    //       results = engine.readtext(image)
    //       return "\n".join(text for _bbox, text, _conf in results)

    return ''
  }

  private _errorResult(message: string): Record<string, any> {
    return {
      parsed_content: { input_type: 'image', error: message },
      detected_language: null,
      confidence: 0.0,
      metadata: { sensitivity_level: 0 },
    }
  }
}

// ------------------------------------------------------------------
// 辅助函数
// ------------------------------------------------------------------

/** 检查字节前缀是否为已知图像格式 magic bytes。 */
function _isImageMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false
  }
  // PNG: \x89PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true
  }
  // JPEG: \xff\xd8\xff\xe0 或 \xff\xd8\xff\xe1
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      (bytes[3] === 0xe0 || bytes[3] === 0xe1)) {
    return true
  }
  return false
}

/** Base64 解码为 Uint8Array。 */
function _base64Decode(str: string): Uint8Array | null {
  try {
    const cleaned = str.replace(/\s/g, '')
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}
