import * as React from "react"

import { cn } from "@/lib/utils"

function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={cn("inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs", className)}
      {...props}
    />
  )
}

export { Badge }
