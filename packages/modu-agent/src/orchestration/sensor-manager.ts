// 对应 Python: orchestration/sensor_manager.py
// Sensor 生命周期管理（从 Coordinator 提取）
import type { BaseSensor } from '../core/interfaces/perception.js'
import { getRegistry } from '../core/registry.js'
import { get_event_bus } from './communication/message-bus.js'
import { AgentEvent, EventAction, EventDomain } from './communication/protocol.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[sensor-manager] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[sensor-manager] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[sensor-manager] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[sensor-manager] ${msg}`, ...args),
}

interface SensorTask {
  abortController: AbortController
  promise: Promise<void>
}

/**
 * 传感器生命周期管理器。
 *
 * 通过 registry 查找 BaseSensor 实例，后台异步运行采集循环，
 * 将捕获的数据发布为 EventBus 事件。
 */
export class SensorManager {
  private _registry: any
  private _event_bus: any
  private _sensor_tasks: Map<string, SensorTask> = new Map()

  constructor(registry: any = null, event_bus: any = null) {
    this._registry = registry ?? getRegistry()
    this._event_bus = event_bus ?? get_event_bus()
  }

  /**
   * 启动指定的传感器，后台异步运行。
   * 传感器捕获的数据通过 EventBus 发布为 PERCEPTION 域事件。
   */
  async start_sensors(sensor_names: string[]): Promise<void> {
    for (const name of sensor_names) {
      if (this._sensor_tasks.has(name)) {
        logger.warning("Sensor '%s' already running", name)
        continue
      }

      const sensor = this._registry.getSensor(name)
      if (!sensor) {
        logger.warning("Sensor '%s' not registered, skipping", name)
        continue
      }

      const abortController = new AbortController()
      const promise = this._run_sensor(name, sensor, abortController.signal)
      this._sensor_tasks.set(name, { abortController, promise })
      logger.info('Started sensor: %s', name)
    }
  }

  /**
   * 停止指定的传感器，未指定则停止全部。
   */
  async stop_sensors(sensor_names?: string[] | null): Promise<void> {
    const names = sensor_names ?? [...this._sensor_tasks.keys()]
    for (const name of names) {
      const task = this._sensor_tasks.get(name)
      if (task) {
        task.abortController.abort()
        try {
          await task.promise
        } catch {
          // aborted
        }
        this._sensor_tasks.delete(name)
        logger.info('Stopped sensor: %s', name)
      }
    }
  }

  /**
   * 传感器运行循环：定时捕获并发布事件。
   */
  private async _run_sensor(name: string, sensor: BaseSensor, signal: AbortSignal): Promise<void> {
    logger.info("Sensor '%s' (type=%s) started", name, sensor.sensorType())
    try {
      while (!signal.aborted) {
        try {
          const raw_data = await sensor.capture({ user_id: 'system' })
          if (raw_data) {
            const event = new AgentEvent({
              trace_id: `sensor_${name}`,
              session_id: 'sensor',
              user_id: 'system',
              domain: EventDomain.PERCEPTION,
              action: EventAction.ANALYZE_SCENE,
              payload: raw_data,
              metadata: {
                sensor_name: name,
                sensor_type: sensor.sensorType(),
                data_size: String(raw_data.length),
              },
            })
            await this._event_bus.publish(event)
          }
        } catch (e) {
          logger.error("Sensor '%s' capture error: %s", name, String(e))
        }

        // 采集间隔（可被 abort 中断）
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 1000)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
      }
      logger.info("Sensor '%s' cancelled", name)
    } catch (e) {
      logger.info("Sensor '%s' cancelled", name)
    }
  }
}
