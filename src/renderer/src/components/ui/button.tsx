import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-foreground hover:bg-accent-hover',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-surface hover:bg-hover active:bg-active',
        ghost: 'text-foreground hover:bg-hover active:bg-active',
        subtle: 'text-muted-foreground hover:bg-hover hover:text-foreground active:bg-active'
      },
      size: {
        default: 'h-9 px-4 text-sm',
        sm: 'h-8 px-3 text-sm',
        icon: 'size-8',
        'icon-sm': 'size-7'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
