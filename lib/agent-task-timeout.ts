export const AGENT_TASK_TIMEOUT_SECONDS = 60 * 60
export const AGENT_TASK_TIMEOUT_ERROR = "任务超时：超过 1 小时未完成"

export function isAgentTaskTimeoutError(error?: string | null) {
  return error === AGENT_TASK_TIMEOUT_ERROR
}
