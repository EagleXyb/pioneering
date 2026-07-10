// 对应 Python: core/interfaces/memory.py
// BaseMemory + BaseStorageAdapter 抽象接口

/**
 * 记忆抽象接口。
 * 对应 Python BaseMemory（query / update）。
 */
export abstract class BaseMemory {
  abstract query(
    userId: string,
    contextWindow: string,
    requiredFields: string[],
  ): Promise<Record<string, any>> | Record<string, any>

  abstract update(
    userId: string,
    newData: Record<string, any>,
    metadata: Record<string, any>,
  ): Promise<boolean> | boolean
}

/**
 * 存储适配器抽象接口。
 * 对应 Python BaseStorageAdapter（adapter_type / load / save）。
 */
export abstract class BaseStorageAdapter {
  abstract adapterType(): string

  abstract load(key: string): Promise<Record<string, any> | null> | Record<string, any> | null

  abstract save(key: string, data: Record<string, any>): Promise<boolean> | boolean
}
