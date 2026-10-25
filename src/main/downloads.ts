import { existsSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { app, type DownloadItem, type Session, type WebContents } from 'electron'

export interface DownloadInfo {
  id: number
  filename: string
  path: string
  url: string
  mime: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  startedAt: string
  /** Guest webContents that started it, to map back to a tab */
  webContentsId?: number
}

const MAX_TRACKED = 50
const downloads: DownloadInfo[] = []
let nextId = 1

/** "name.png" → "name (1).png" … until the path is free. */
export function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

export const recentDownloads = (): DownloadInfo[] => [...downloads].reverse()

/**
 * Without a save path Electron opens a "Save as" dialog and leaves the bytes in a
 * <GUID>.tmp until someone answers it. Every download goes straight to the Downloads
 * folder instead, with its real name made unique.
 */
export function handleDownloads(ses: Session, onFinished: (info: DownloadInfo) => void): void {
  ses.on('will-download', (_event, item: DownloadItem, source?: WebContents) => {
    const filename = item.getFilename() || 'download'
    const path = uniquePath(app.getPath('downloads'), filename)
    item.setSavePath(path)

    const info: DownloadInfo = {
      id: nextId++,
      filename: basename(path),
      path,
      url: item.getURL(),
      mime: item.getMimeType(),
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: new Date().toISOString(),
      webContentsId: source?.id
    }
    downloads.push(info)
    if (downloads.length > MAX_TRACKED) downloads.shift()

    item.on('updated', () => {
      info.receivedBytes = item.getReceivedBytes()
      info.totalBytes = item.getTotalBytes()
    })
    item.once('done', (_e, state) => {
      info.state = state
      info.receivedBytes = item.getReceivedBytes()
      onFinished(info)
    })
  })
}

export const isTrackedDownload = (path: string): boolean => downloads.some((d) => d.path === path)
