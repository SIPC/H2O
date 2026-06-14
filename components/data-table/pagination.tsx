"use client"

import type { Table } from "@tanstack/react-table"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface DataTablePaginationProps<TData> {
  table: Table<TData>
  pageSizeOptions?: number[]
  /** 手动分页时的总行数 */
  totalRows?: number
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 20, 30, 50],
  totalRows,
}: DataTablePaginationProps<TData>) {
  const { t } = useI18n()
  const effectiveTotal = totalRows ?? table.getFilteredRowModel().rows.length
  return (
    <div className="flex items-center justify-between px-2">
      <div className="flex flex-1 items-center gap-4 text-sm text-muted-foreground">
        <div>
          {table.getFilteredSelectedRowModel().rows.length > 0
            ? t("dataTable.selectedRows", {
                selected: table.getFilteredSelectedRowModel().rows.length,
                total: effectiveTotal,
              })
            : t("dataTable.totalRows", { total: effectiveTotal })}
        </div>
        <div className="flex items-center space-x-2">
          <p className="font-medium text-foreground">
            {t("dataTable.rowsPerPage")}
          </p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value))
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top" position="popper">
              {pageSizeOptions.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center space-x-6 lg:space-x-8">
        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
          {t("dataTable.pageIndicator", {
            page: table.getState().pagination.pageIndex + 1,
            pageCount: table.getPageCount(),
          })}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">{t("dataTable.firstPage")}</span>
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">{t("dataTable.previousPage")}</span>
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">{t("dataTable.nextPage")}</span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">{t("dataTable.lastPage")}</span>
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
