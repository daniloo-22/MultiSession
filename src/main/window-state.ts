import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { FILES, readJson, writeJson } from './storage'

interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const DEFAULT_BOUNDS = { width: 1280, height: 820 }

export function loadWindowState(): Partial<Rectangle> & { maximized: boolean } {
  const saved = readJson<WindowState>(FILES.window())
  if (!saved?.bounds) return { ...DEFAULT_BOUNDS, maximized: false }

  // Drop the saved position if that monitor is no longer connected.
  const visible = screen.getAllDisplays().some(({ workArea: d }) => {
    const b = saved.bounds
    return b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y
  })
  const bounds = visible
    ? saved.bounds
    : { width: saved.bounds.width, height: saved.bounds.height }
  return { ...bounds, maximized: Boolean(saved.maximized) }
}

export function trackWindowState(win: BrowserWindow): () => void {
  let timer: NodeJS.Timeout | undefined

  const save = (): void => {
    clearTimeout(timer)
    if (win.isDestroyed() || win.isMinimized()) return
    try {
      writeJson(FILES.window(), {
        bounds: win.getNormalBounds(),
        maximized: win.isMaximized()
      } satisfies WindowState)
    } catch (err) {
      console.error('[window-state] salvataggio fallito', err)
    }
  }

  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, 500)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  return save
}
