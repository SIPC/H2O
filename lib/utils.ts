import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const BYTES_PER_GB = 1024 ** 3

export function bytesToGbString(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0"
  return String(Number((bytes / BYTES_PER_GB).toFixed(4)))
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let value = bytes
  let idx = 0

  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }

  const decimals = idx === 0 ? 0 : value >= 100 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[idx]}`
}
