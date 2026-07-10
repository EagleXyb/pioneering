// 对应 Python: core/interfaces/perception.py
// BasePerception + BaseSensor 抽象接口

/**
 * 感知器抽象接口。
 * 对应 Python BasePerception（perceive）。
 */
export abstract class BasePerception {
  abstract perceive(
    inputType: string,
    rawContent: Uint8Array,
    language?: string | null,
    sensitivityLevel?: number,
  ): Promise<Record<string, any>> | Record<string, any>
}

/**
 * 传感器抽象接口。
 * 对应 Python BaseSensor（sensor_type / capture）。
 */
export abstract class BaseSensor {
  abstract sensorType(): string

  abstract capture(context: Record<string, any>): Promise<Uint8Array> | Uint8Array
}
