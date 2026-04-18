import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  // 外层包一层横向滚动，防止列多时表格撑破卡片
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  )
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b", className)} {...props} />
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  )
}

function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b", className)} {...props} />
}

function TH({ className, ...props }: React.ComponentProps<"th">) {
  // 表头默认不换行，避免窄屏把列标题撕成多行
  return (
    <th
      className={cn(
        "px-3 py-2 text-left font-medium whitespace-nowrap",
        className
      )}
      {...props}
    />
  )
}

function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />
}

export { Table, THead, TBody, TR, TH, TD }
