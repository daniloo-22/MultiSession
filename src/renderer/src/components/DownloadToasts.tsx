import { useEffect, useState } from 'react'
import { CircleAlert, Download, FolderOpen, X } from 'lucide-react'
import type { DownloadNotice } from '@shared/types'
import { Button } from '@/components/ui/button'

const VISIBLE_MS = 6000

type Toast = DownloadNotice & { key: number }

/** Downloads are saved without a dialog, so say where each one ended up. */
export function DownloadToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    let key = 0
    return window.api.onDownloadDone((notice) => {
      const toast = { ...notice, key: key++ }
      setToasts((list) => [...list.slice(-2), toast])
      setTimeout(() => setToasts((list) => list.filter((t) => t.key !== toast.key)), VISIBLE_MS)
    })
  }, [])

  const dismiss = (key: number): void => setToasts((list) => list.filter((t) => t.key !== key))

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const ok = t.state === 'completed'
        return (
          <div
            key={t.key}
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-surface py-2.5 pr-2 pl-3.5 shadow-float"
          >
            {ok ? (
              <Download className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <CircleAlert className="size-4 shrink-0 text-destructive" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{t.filename}</span>
              <span className="text-xs text-muted-foreground">
                {ok ? 'Salvato in Download' : 'Download non completato'}
              </span>
            </div>
            {ok && (
              <Button variant="subtle" size="icon-sm" aria-label="Mostra nella cartella" onClick={() => window.api.showInFolder(t.path)}>
                <FolderOpen />
              </Button>
            )}
            <Button variant="subtle" size="icon-sm" aria-label="Chiudi" onClick={() => dismiss(t.key)}>
              <X />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
