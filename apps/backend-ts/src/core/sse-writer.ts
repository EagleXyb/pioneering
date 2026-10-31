/**
 * SSE 写入器（背压）
 *
 * 背景：`reply.raw.write()` 在客户端消费不过来时返回 false，原实现忽略该返回值，
 * 慢客户端会让 Node 的 socket 写缓冲无界增长（多 Tab / 弱网 / 长回答时更明显）。
 *
 * 这里把「write 返回 false → 等 drain」收敛成一处：
 *   - 正常写入：直接返回 true；
 *   - 缓冲满：挂起直到 drain（真正的背压），或连接关闭；
 *   - 等待超过上限：主动 destroy，避免一个不读的客户端拖住整个进程。
 *
 * 注意：本类不负责 SSE 帧格式与 seq 分配，调用方只传完整帧文本。
 */
import type { ServerResponse } from 'node:http'

export interface SseWriterOptions {
  /** 等待 drain 的上限（毫秒），超时后主动断开慢客户端 */
  drainTimeoutMs?: number
}

export class SseWriter {
  private _closed = false

  constructor(
    private readonly raw: ServerResponse,
    private readonly opts: SseWriterOptions = {},
  ) {
    raw.once('close', () => {
      this._closed = true
    })
  }

  get closed(): boolean {
    return this._closed || this.raw.destroyed || this.raw.writableEnded
  }

  /** 写一帧；连接已关闭返回 false，否则在必要时等待 drain。 */
  async write(chunk: string): Promise<boolean> {
    if (this.closed) return false

    try {
      if (this.raw.write(chunk)) return true
    } catch {
      this._closed = true
      return false
    }

    return this._waitForDrain()
  }

  private _waitForDrain(): Promise<boolean> {
    const timeoutMs = Math.max(1_000, this.opts.drainTimeoutMs ?? 60_000)

    return new Promise<boolean>((resolve) => {
      let settled = false

      const cleanup = () => {
        this.raw.off('drain', onDrain)
        this.raw.off('close', onClose)
        clearTimeout(timer)
      }
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(ok)
      }
      const onDrain = () => finish(true)
      const onClose = () => finish(false)
      const timer = setTimeout(() => {
        // 客户端长期不消费：主动断开，释放 socket 缓冲
        this._closed = true
        try {
          this.raw.destroy()
        } catch {
          // 已销毁
        }
        finish(false)
      }, timeoutMs)
      ;(timer as unknown as { unref?: () => void }).unref?.()

      this.raw.once('drain', onDrain)
      this.raw.once('close', onClose)
    })
  }
}
