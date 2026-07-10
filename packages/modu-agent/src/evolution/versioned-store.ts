// 对应 Python: evolution/registry/versioned_store.py
// VersionedComponentStore: 组件版本快照存储

import fs from 'fs'
import path from 'path'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[versioned-store] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[versioned-store] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[versioned-store] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[versioned-store] ${msg}`, ...args),
}

/**
 * 检查值是否可以被 JSON 序列化。
 *
 * 对应 Python _is_json_serializable。
 */
function isJsonSerializable(value: any): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isJsonSerializable)
  }
  if (typeof value === 'object') {
    return Object.entries(value).every(
      ([k, v]) => typeof k === 'string' && isJsonSerializable(v),
    )
  }
  return false
}

/**
 * 组件版本快照存储。
 *
 * 对应 Python VersionedComponentStore。
 *
 * 适配说明：Python 版通过 inspect.signature 反射构造函数参数签名，
 * 并通过 importlib.import_module 动态导入模块重建组件实例。
 * TS/ESM 不支持运行时参数签名反射，也不支持同步动态 import()，
 * 因此：
 *   - 序列化：扫描对象自身可枚举属性（_paramName / paramName 模式）
 *   - 反序列化：优先从内存缓存取回组件实例；磁盘反序列化返回 null
 *   - 内存缓存保证同进程内 rollback 可用（与 Python 同进程行为等价）
 */
export class VersionedComponentStore {
  private _storagePath: string
  // 内存缓存：key = "componentName:version" → component 实例
  // ESM 无同步动态 import，缓存保证同进程内回滚可用
  private _componentCache: Map<string, any> = new Map()

  constructor(storagePath: string = 'evolution/versions') {
    this._storagePath = storagePath
  }

  /** 获取组件的存储目录路径。 */
  private _getComponentDir(componentName: string): string {
    return path.join(this._storagePath, componentName)
  }

  /** 获取指定版本的 JSON 文件路径。 */
  private _getVersionFilePath(componentName: string, version: string): string {
    return path.join(this._getComponentDir(componentName), `${version}.json`)
  }

  /** 获取版本索引文件路径。 */
  private _getVersionsIndexPath(componentName: string): string {
    return path.join(this._getComponentDir(componentName), '_versions.json')
  }

  /** 加载版本索引列表。 */
  private _loadVersionsIndex(componentName: string): string[] {
    const indexPath = this._getVersionsIndexPath(componentName)
    if (fs.existsSync(indexPath)) {
      try {
        return JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
      } catch (e) {
        logger.warning('Failed to parse versions index for %s: %s', componentName, String(e))
        return []
      }
    }
    return []
  }

  /** 保存版本索引列表。 */
  private _saveVersionsIndex(componentName: string, versions: string[]): void {
    const componentDir = this._getComponentDir(componentName)
    fs.mkdirSync(componentDir, { recursive: true })
    const indexPath = this._getVersionsIndexPath(componentName)
    fs.writeFileSync(indexPath, JSON.stringify(versions, null, 2), 'utf-8')
  }

  /**
   * 序列化组件配置（提取构造参数）。
   *
   * 适配 TS：无法通过 inspect.signature 获取构造函数参数签名，
   * 改为扫描对象自身可枚举属性，匹配 _paramName / paramName 模式。
   * 存储 class_name 和 init_params，回滚时通过内存缓存或反射重建。
   */
  static _serializeComponentConfig(component: any): Record<string, any> | null {
    if (component === null || component === undefined) {
      return null
    }

    try {
      const cls = component.constructor
      const className = cls?.name ?? 'Unknown'
      // TS 没有 __module__，module_path 留空
      const modulePath: string | undefined = undefined

      const initParams: Record<string, any> = {}

      // 扫描对象自身属性（对应 Python 的 dir() fallback 分支）
      const ownProps = Object.getOwnPropertyNames(component)
      for (const attrName of ownProps) {
        // 跳过内部/双下划线属性
        if (attrName.startsWith('__')) continue

        try {
          const value = component[attrName]
          if (typeof value === 'function') continue
          if (isJsonSerializable(value)) {
            // 去除前导下划线以匹配构造参数名（Python _paramName → paramName）
            const cleanName = attrName.startsWith('_') ? attrName.slice(1) : attrName
            initParams[cleanName] = value
          }
        } catch {
          continue
        }
      }

      return {
        module_path: modulePath,
        class_name: className,
        init_params: initParams,
      }
    } catch (e) {
      logger.warning('Failed to serialize component config: %s', String(e))
      return null
    }
  }

  /**
   * 从配置反序列化重建组件实例。
   *
   * 适配 TS：ESM 不支持同步 import()，无法像 Python importlib 那样
   * 在同步方法中动态加载模块。此方法返回 null，实际组件实例
   * 通过内存缓存（_componentCache）在 get_version 中取回。
   */
  static _deserializeComponentConfig(componentConfig: Record<string, any>): any {
    if (!componentConfig) {
      return null
    }

    const modulePath = componentConfig.module_path
    const className = componentConfig.class_name
    const _initParams = componentConfig.init_params ?? {}

    if (!modulePath || !className) {
      logger.warning('Invalid component config: missing module/class info')
      return null
    }

    // ESM 无同步动态 import，无法在此重建实例。
    // 组件实例由 _componentCache 在 get_version 中提供。
    logger.warning(
      'Cannot deserialize component synchronously (ESM limitation): %s.%s',
      modulePath,
      className,
    )
    return null
  }

  /**
   * 保存组件版本快照。
   *
   * @param componentName 组件名称
   * @param version 版本号
   * @param state 组件状态配置
   * @param metadata 元数据
   * @param category 组件分类（用于回滚时调用 registry.swapComponent）
   * @param component 组件实例（用于回滚时恢复）
   */
  saveVersion(
    componentName: string,
    version: string,
    state: Record<string, any>,
    metadata: Record<string, any>,
    category: string = '',
    component: any = null,
  ): void {
    const componentDir = this._getComponentDir(componentName)
    fs.mkdirSync(componentDir, { recursive: true })

    const componentConfig = VersionedComponentStore._serializeComponentConfig(component)

    const versionFilePath = this._getVersionFilePath(componentName, version)
    const versionData: Record<string, any> = {
      version,
      state,
      metadata,
      category,
      component_config: componentConfig,
    }
    fs.writeFileSync(
      versionFilePath,
      JSON.stringify(versionData, null, 2),
      'utf-8',
    )

    // 内存缓存组件实例（ESM 适配：同进程内 rollback 可用）
    if (component !== null && component !== undefined) {
      this._componentCache.set(`${componentName}:${version}`, component)
    }

    const versions = this._loadVersionsIndex(componentName)
    if (!versions.includes(version)) {
      versions.push(version)
      this._saveVersionsIndex(componentName, versions)
    }

    logger.info('Saved version %s for component %s', version, componentName)
  }

  /**
   * 获取指定版本快照。
   *
   * 优先从内存缓存取回 component 实例；
   * 若缓存未命中，尝试从 component_config 反序列化（ESM 下通常返回 null）。
   */
  getVersion(
    componentName: string,
    version: string,
  ): Record<string, any> | null {
    const versionFilePath = this._getVersionFilePath(componentName, version)
    if (!fs.existsSync(versionFilePath)) {
      logger.warning('Version %s not found for component %s', version, componentName)
      return null
    }

    let versionData: Record<string, any>
    try {
      versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf-8'))
    } catch (e) {
      logger.warning('Failed to parse version file for %s %s: %s', componentName, version, String(e))
      return null
    }

    // 优先从内存缓存取回组件实例
    const cachedComponent = this._componentCache.get(`${componentName}:${version}`)
    if (cachedComponent !== undefined) {
      versionData['component'] = cachedComponent
    } else {
      const componentConfig = versionData['component_config']
      if (componentConfig && !('component' in versionData)) {
        versionData['component'] = VersionedComponentStore._deserializeComponentConfig(componentConfig)
      }
    }

    return versionData
  }

  /** 列出组件的所有版本。 */
  listVersions(componentName: string): string[] {
    return this._loadVersionsIndex(componentName)
  }

  /** 获取组件的最新版本号。 */
  getLatestVersion(componentName: string): string | null {
    const versions = this._loadVersionsIndex(componentName)
    if (versions.length === 0) {
      return null
    }
    return versions[versions.length - 1]
  }
}
