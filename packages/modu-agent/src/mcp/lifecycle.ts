// 对应 Python: mcp/lifecycle.py
// MCP Server 子进程生命周期管理。
//
// 仅对 `transport=stdio` 且 `auto_start=True` 的 Server 生效。
// SSE/HTTP 类型的 Server 由远程管理，此处不涉及。

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[mcp] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[mcp] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[mcp] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[mcp] ${msg}`, ...args),
}

/**
 * MCP Server 子进程生命周期管理。
 *
 * StdioTransport.connect() 内部会启动子进程，
 * 此类作为辅助管理器，跟踪进程状态并提供健康检查。
 *
 * 对应 Python ServerLifecycleManager。
 */
export class ServerLifecycleManager {
  /** server_name → tracked */
  private _tracked: Map<string, boolean> = new Map()

  /**
   * 标记一个 Server 为已跟踪。
   *
   * 对应 Python ServerLifecycleManager.track。
   */
  track(name: string): void {
    this._tracked.set(name, true)
    logger.debug("Server '%s' lifecycle tracked", name)
  }

  /**
   * 标记 Server 已停止。
   *
   * 实际子进程终止由 StdioTransport.disconnect() 负责。
   * 此方法仅清理跟踪状态。
   *
   * 对应 Python ServerLifecycleManager.stop_server。
   */
  async stopServer(name: string): Promise<void> {
    this._tracked.delete(name)
    logger.info("Server '%s' lifecycle stopped", name)
  }

  /** 停止所有已跟踪的 Server。 */
  async stopAll(): Promise<void> {
    const names = [...this._tracked.keys()]
    for (const name of names) {
      await this.stopServer(name)
    }
  }

  /**
   * 检查 Server 是否被跟踪。
   *
   * 对应 Python ServerLifecycleManager.is_tracked。
   */
  isTracked(name: string): boolean {
    return this._tracked.get(name) ?? false
  }

  /** 返回已跟踪 Server 的快照。 */
  get trackedServers(): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const [name, tracked] of this._tracked) {
      result[name] = tracked
    }
    return result
  }
}
