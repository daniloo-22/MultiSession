import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

function Tooltip({
  children,
  content,
  side = 'bottom',
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  content: React.ReactNode
  side?: TooltipPrimitive.TooltipContentProps['side']
}) {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipContent side={side}>{content}</TooltipContent>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Content
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-80 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground shadow-float',
        className
      )}
      {...props}
    />
  )
}

export { Tooltip, TooltipContent, TooltipProvider }
