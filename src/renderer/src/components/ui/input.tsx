import * as React from 'react'
import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      spellCheck={false}
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  )
}

export { Input }
