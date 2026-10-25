import { ipcMain, type BrowserWindow } from 'electron'
import { IPC, type ControlCommand, type ControlResult } from '@shared/types'

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }

/** Request/response over IPC to the renderer, which owns the tab list (Zustand store). */
export class RendererRpc {
  private next = 1
  private pending = new Map<number, Pending>()

  constructor(private getWindow: () => BrowserWindow | null) {
    ipcMain.on(IPC.controlResult, (_event, result: ControlResult) => {
      const p = this.pending.get(result.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(result.id)
      if (result.ok) p.resolve(result.value)
      else p.reject(new Error(result.error ?? 'errore nel renderer'))
    })
  }

  call<T = unknown>(cmd: ControlCommand['cmd'], args?: unknown): Promise<T> {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return Promise.reject(new Error('finestra non disponibile'))
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('il renderer non ha risposto'))
      }, 10000)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      win.webContents.send(IPC.controlCommand, { id, cmd, args })
    })
  }
}
