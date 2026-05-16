export const PLAN_TRAFFIC_BILLING_MODES = ["tx_rx", "tx", "rx"] as const

export type PlanTrafficBillingMode =
  (typeof PLAN_TRAFFIC_BILLING_MODES)[number]

export function isPlanTrafficBillingMode(
  value: unknown
): value is PlanTrafficBillingMode {
  return (
    typeof value === "string" &&
    PLAN_TRAFFIC_BILLING_MODES.includes(value as PlanTrafficBillingMode)
  )
}

export function normalizePlanTrafficBillingMode(
  value: unknown
): PlanTrafficBillingMode {
  return isPlanTrafficBillingMode(value) ? value : "tx_rx"
}

export function getBillableTrafficBytes(
  mode: PlanTrafficBillingMode | string | null | undefined,
  txBytes: number,
  rxBytes: number
) {
  const normalized = normalizePlanTrafficBillingMode(mode)
  if (normalized === "tx") return txBytes
  if (normalized === "rx") return rxBytes
  return txBytes + rxBytes
}
