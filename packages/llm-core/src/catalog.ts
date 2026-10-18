// 模型目录与别名解析（P1）
//
// 职责：把"客户端传什么"（别名 / 真实 ID / 空）统一解析为一个 ModelDescriptor。
// 不负责：密钥、端点、重试策略 —— 这些属于各宿主的装配层。
import { LLMError, type ModelDescriptor } from '@pioneering/llm-contracts'

export interface CatalogOptions {
  models: readonly ModelDescriptor[]
  /** 别名 → 真实模型 ID；未命中的键按真实 ID 处理 */
  aliases?: Readonly<Record<string, string>>
  /** 未指定模型时使用的别名 */
  defaultAlias?: string
}

export class ModelCatalog {
  private readonly _models: readonly ModelDescriptor[]
  private readonly _byAlias = new Map<string, ModelDescriptor>()
  private readonly _byModelId = new Map<string, ModelDescriptor>()
  private readonly _aliases: Readonly<Record<string, string>>
  private readonly _defaultAlias: string | undefined

  constructor(opts: CatalogOptions) {
    if (opts.models.length === 0) {
      throw new Error('ModelCatalog: models 不能为空')
    }
    this._models = [...opts.models]
    this._aliases = opts.aliases ?? {}
    this._defaultAlias = opts.defaultAlias ?? this._models[0]?.alias

    for (const model of this._models) {
      this._byAlias.set(model.alias, model)
      this._byModelId.set(model.model_id, model)
    }
  }

  /**
   * 解析模型标识。
   *
   * 顺序：空值 → 默认别名；别名表命中 → 再按别名/真实 ID 查；
   * 未命中则视为直接指定真实 ID；仍查不到 → INVALID_MODEL。
   */
  resolve(input?: string | null): ModelDescriptor {
    const key = (input ?? '').trim()
    if (!key) return this.getDefault()

    const mapped = this._aliases[key] ?? key
    const model =
      this._byAlias.get(mapped) ??
      this._byModelId.get(mapped) ??
      this._byAlias.get(key) ??
      this._byModelId.get(key)

    if (!model) {
      throw new LLMError('INVALID_MODEL', `未知模型：${key}`)
    }
    if (model.status === 'sunset') {
      throw new LLMError(
        'INVALID_MODEL',
        `模型 ${key} 已下线${model.disable_reason ? `（${model.disable_reason}）` : ''}`,
      )
    }
    return model
  }

  /**
   * 候选链（为后续多 provider 失败转移预留）。
   *
   * P1 只有单跳，返回 [解析结果]；未来可在 descriptor 上扩展 fallbacks。
   */
  candidates(input?: string | null): ModelDescriptor[] {
    return [this.resolve(input)]
  }

  /** 全部模型（默认过滤 sunset）。 */
  list(opts: { includeSunset?: boolean } = {}): ModelDescriptor[] {
    return opts.includeSunset
      ? [...this._models]
      : this._models.filter((m) => m.status !== 'sunset')
  }

  getDefault(): ModelDescriptor {
    const model =
      (this._defaultAlias ? this._byAlias.get(this._defaultAlias) : undefined) ??
      this._models[0]
    if (!model) throw new LLMError('INVALID_MODEL', '模型目录为空')
    return model
  }
}
