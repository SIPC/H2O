"use client"

import * as React from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type Table as TableType,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DataTablePagination } from "./pagination"
import { Skeleton } from "@/components/ui/skeleton"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** 初始每页行数，默认 10 */
  defaultPageSize?: number
  /** 可选的每页行数选项 */
  pageSizeOptions?: number[]
  /** 是否启用行选择 */
  enableRowSelection?: boolean
  /** 隐藏内建分页 */
  hidePagination?: boolean
  /** 工具栏渲染函数，接收 table 实例以访问列等 */
  renderToolbar?: (table: TableType<TData>) => React.ReactNode
  /** 服务端手动分页模式 */
  manualPagination?: boolean
  /** 手动分页时的总页数 */
  pageCount?: number
  /** 手动分页时的当前页码（1-based） */
  page?: number
  /** 手动分页时的每页行数 */
  pageSize?: number
  /** 手动分页时的总行数 */
  totalRows?: number
  /** 页码变更回调（1-based） */
  onPageChange?: (page: number) => void
  /** 每页行数变更回调 */
  onPageSizeChange?: (pageSize: number) => void
  /** 加载中时显示骨架行 */
  loading?: boolean
  /** 骨架行数量，默认 8 */
  loadingRowCount?: number
}

export function DataTable<TData, TValue>({
  columns,
  data,
  defaultPageSize = 10,
  pageSizeOptions = [10, 20, 30, 50],
  enableRowSelection = false,
  hidePagination = false,
  renderToolbar,
  manualPagination = false,
  pageCount,
  page,
  pageSize: controlledPageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
  loading = false,
  loadingRowCount = 8,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [internalPagination, setInternalPagination] =
    React.useState<PaginationState>({
      pageIndex: 0,
      pageSize: defaultPageSize,
    })

  const pagination: PaginationState = manualPagination
    ? {
        pageIndex: (page ?? 1) - 1,
        pageSize: controlledPageSize ?? defaultPageSize,
      }
    : internalPagination

  const onPaginationChange = manualPagination
    ? (
        updater: PaginationState | ((old: PaginationState) => PaginationState)
      ) => {
        const newPagination =
          typeof updater === "function" ? updater(pagination) : updater
        if (newPagination.pageIndex !== pagination.pageIndex) {
          onPageChange?.(newPagination.pageIndex + 1)
        }
        if (newPagination.pageSize !== pagination.pageSize) {
          onPageSizeChange?.(newPagination.pageSize)
        }
      }
    : setInternalPagination

  // TanStack Table 官方 hook 返回不可安全 memoize 的函数，React Compiler 会跳过该组件。
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
    },
    enableRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getSortedRowModel: getSortedRowModel(),
    ...(manualPagination
      ? { manualPagination: true, pageCount: pageCount ?? -1 }
      : { getPaginationRowModel: getPaginationRowModel() }),
  })

  return (
    <div className="space-y-3">
      {renderToolbar && (
        <div className="flex items-center gap-2">{renderToolbar(table)}</div>
      )}
      <div className="overflow-hidden rounded-md">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: loadingRowCount }).map((_, rowIndex) => (
                <TableRow key={`loading-${rowIndex}`}>
                  {table.getVisibleLeafColumns().map((column, columnIndex) => (
                    <TableCell key={column.id}>
                      <Skeleton
                        className={
                          columnIndex === 0
                            ? "h-4 w-12"
                            : columnIndex % 3 === 0
                              ? "h-4 w-24"
                              : columnIndex % 3 === 1
                                ? "h-4 w-32"
                                : "h-4 w-20"
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {!hidePagination && (
        <DataTablePagination
          table={table}
          pageSizeOptions={pageSizeOptions}
          totalRows={totalRows}
        />
      )}
    </div>
  )
}
