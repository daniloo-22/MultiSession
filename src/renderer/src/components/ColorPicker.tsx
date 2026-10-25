import { Check } from 'lucide-react'
import { ACCOUNT_COLORS } from '@/lib/colors'
import { cn } from '@/lib/utils'

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACCOUNT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colore ${c}`}
          aria-pressed={c === value}
          onClick={() => onChange(c)}
          className={cn(
            'flex size-7 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            c === value && 'ring-2 ring-foreground/25 ring-offset-2 ring-offset-surface'
          )}
          style={{ backgroundColor: c }}
        >
          {c === value && <Check className="size-3.5 text-white" />}
        </button>
      ))}
    </div>
  )
}
