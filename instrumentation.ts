const NOTIFICATION_CHECK_INTERVAL_MS = 60 * 1000
const NOTIFICATION_INITIAL_DELAY_MS = 15 * 1000
const NEXT_PHASE_PRODUCTION_BUILD = "phase-production-build"

declare global {
  var __h2oNotificationTimer: ReturnType<typeof setInterval> | undefined
  var __h2oNotificationCheckRunning: boolean | undefined
}

async function runSafely(runNotificationChecks: () => Promise<unknown>) {
  if (globalThis.__h2oNotificationCheckRunning) return
  globalThis.__h2oNotificationCheckRunning = true
  try {
    await runNotificationChecks()
  } catch (error) {
    console.error("notification scheduler failed", error)
  } finally {
    globalThis.__h2oNotificationCheckRunning = false
  }
}

export async function register() {
  if (process.env.NEXT_PHASE === NEXT_PHASE_PRODUCTION_BUILD) return
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return
  if (globalThis.__h2oNotificationTimer) return

  const { runNotificationChecks } = await import("@/lib/notifications")

  const initial = setTimeout(() => {
    void runSafely(runNotificationChecks)
  }, NOTIFICATION_INITIAL_DELAY_MS)
  initial.unref?.()

  const timer = setInterval(() => {
    void runSafely(runNotificationChecks)
  }, NOTIFICATION_CHECK_INTERVAL_MS)
  timer.unref?.()
  globalThis.__h2oNotificationTimer = timer
}
