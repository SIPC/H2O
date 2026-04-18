import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full text-sm", className)} {...props} />
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b", className)} {...props} />
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b", className)} {...props} />
}

function TH({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("px-3 py-2 text-left font-medium", className)} {...props} />
}

function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2", className)} {...props} />
}

export { Table, THead, TBody, TR, TH, TD }
