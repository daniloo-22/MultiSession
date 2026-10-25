import { useEffect, useState } from 'react'
import type { Environment } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { pickColor } from '@/lib/colors'
import { useAppStore } from '@/store/app-store'
import { ColorPicker } from './ColorPicker'

/** `environment` undefined = create mode. */
export function EnvironmentDialog({
  open,
  environment,
  onOpenChange
}: {
  open: boolean
  environment?: Environment
  onOpenChange: (open: boolean) => void
}) {
  const environments = useAppStore((s) => s.environments)
  const addEnvironment = useAppStore((s) => s.addEnvironment)
  const updateEnvironment = useAppStore((s) => s.updateEnvironment)

  const [name, setName] = useState('')
  const [color, setColor] = useState('')

  useEffect(() => {
    if (!open) return
    setName(environment?.name ?? '')
    setColor(environment?.color ?? pickColor(environments.map((e) => e.color)))
    // Reset only when the dialog opens.
  }, [open, environment?.id])

  const submit = (): void => {
    const data = { name: name.trim() || 'Nuovo ambiente', color }
    if (environment) updateEnvironment(environment.id, data)
    else addEnvironment(data)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{environment ? 'Modifica ambiente' : 'Nuovo ambiente'}</DialogTitle>
          <DialogDescription>
            Un ambiente raccoglie i suoi account e le sue schede, separati da quelli degli altri ambienti.
          </DialogDescription>
        </DialogHeader>

        <form
          id="environment-form"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="environment-name">Nome</Label>
            <Input
              id="environment-name"
              autoFocus
              value={name}
              placeholder="Es. Scuola"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2.5">
            <Label>Colore</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button type="submit" form="environment-form">
            {environment ? 'Salva' : 'Crea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
