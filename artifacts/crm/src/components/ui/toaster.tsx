import * as React from "react"
import { useToast } from "@/hooks/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <div className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]">
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <div
            key={id}
            {...props}
            className="group pointer-events-auto relative flex w-full items-start gap-4 p-4 pr-6 overflow-hidden rounded-lg border border-primary/20 bg-background shadow-xl transition-all duration-300 animate-in slide-in-from-right-full mt-2 max-w-sm ml-auto"
          >
            <div className="grid gap-1 flex-1">
              {title && <div className="text-sm font-semibold font-display">{title}</div>}
              {description && (
                <div className="text-sm text-muted-foreground">{description}</div>
              )}
            </div>
            {action}
          </div>
        )
      })}
    </div>
  )
}
