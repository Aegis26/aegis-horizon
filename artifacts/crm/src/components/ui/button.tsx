import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 font-display tracking-tight relative overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-background shadow-sm hover:shadow-[0_0_16px_rgba(0,180,216,0.3)] hover:-translate-y-[1px] hover:bg-primary/95 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-0 active:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:-translate-y-[1px] hover:bg-destructive/90 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-0",
        outline:
          "border border-primary/30 bg-transparent text-primary hover:bg-primary/10 hover:border-primary hover:shadow-[0_0_12px_rgba(0,180,216,0.15)] active:bg-primary/20 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]",
        secondary:
          "bg-transparent text-secondary border border-secondary/30 hover:bg-secondary/10 hover:border-secondary hover:shadow-[0_0_12px_rgba(0,102,204,0.15)] active:bg-secondary/20 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]",
        ghost: "hover:bg-primary/10 text-primary active:bg-primary/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-8 rounded-md px-3 py-1.5 text-xs",
        lg: "h-12 rounded-md px-6 py-3 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
