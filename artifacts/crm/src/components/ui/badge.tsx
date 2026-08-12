import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 font-display text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 tracking-tight",
  {
    variants: {
      variant: {
        default:
          "border-success/30 bg-success/10 text-success hover:bg-success/15 hover:border-success/50",
        secondary:
          "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary/50",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:border-destructive/50",
        warning:
          "border-warning/30 bg-warning/10 text-warning hover:bg-warning/15 hover:border-warning/50",
        info:
          "border-info/30 bg-info/10 text-info hover:bg-info/15 hover:border-info/50",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
