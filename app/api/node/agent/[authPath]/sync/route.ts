import { NextResponse } from "next/server"

import {
  buildNodeDesiredConfig,
  detectOrigin,
  getTaskLeaseSeconds,
  isAgentTaskType,
  rememberAgentNonce,
  verifyAgentRequestSignature,
} from "@/lib/agent-control"
import { getDb } from "@/lib/db"

type AgentSyncPayload = {
  agent_version?: unknown
  hostname?: unknown
  os?: unknown
  arch?: unknown
  service_manager?: unknown
  hy2_status?: unknown
  hy2_version?: unknown
  hysteria_config_path?: unknown
  hysteria_config_hash?: unknown
  applied_config_revision?: unknown
  last_config_apply_at?: unknown
  last_error?: unknown
  capabilities?: unknown
  current_config_revision?: unknown
  task_results?: unknown
}

type TaskResultPayload = {
  id?: unknown
  status?: unknown
  result?: unknown
  error?: unknown
}

type NodeForAuth = {
  id: number
  name: string
  status: string
  agent_secret: string | null
  agent_control_enabled: 0 | 1 | null
}

type ClaimedTask = {
  id: number
  type: string
  payload: string | null
}

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status })
}

function normalizeString(input: unknown, maxLength: number) {
  if (input === undefined || input === null || input === "") return null
  if (typeof input !== "string") return false
  const value = input.trim()
  if (!value || value.length > maxLength || /[\r\n]/.test(value)) return false
  return value
}

function normalizeOutputString(input: unknown, maxLength: number) {
  if (input === undefined || input === null || input === "") return null
  if (typeof input !== "string") return false
  const value = input
    .trim()
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
  if (!value || value.length > maxLength) return false
  return value
}

function normalizeHash(input: unknown) {
  const value = normalizeString(input, 128)
  if (value === null || value === false) return value
  return /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : false
}

function normalizeMultilineString(input: unknown, maxLength: number) {
  if (input === undefined || input === null || input === "") return null
  if (typeof input !== "string") return false
  const value = input.trim()
  if (!value || value.length > maxLength) return false
  return value
}

function normalizeRevision(input: unknown) {
  if (input === undefined || input === null) return null
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
    return false
  }
  return input
}

function normalizeCapabilities(input: unknown) {
  if (input === undefined || input === null) return null
  if (!Array.isArray(input)) return false
  const items = input
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 64)
    .slice(0, 64)
  return JSON.stringify(items)
}

function normalizeTaskResults(input: unknown): TaskResultPayload[] | false {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) return false
  if (input.length > 50) return false
  return input as TaskResultPayload[]
}

function normalizeTaskResultStatus(input: unknown) {
  if (input === "succeeded" || input === "failed") return input
  return false
}

function trimTextToJsonLength(
  build: (value: string) => string,
  value: string,
  maxLength: number
) {
  let next = value
  while (next.length > 0) {
    const raw = build(next)
    if (raw.length <= maxLength) return raw
    const overflow = raw.length - maxLength
    next = next.slice(0, Math.max(0, next.length - overflow - 64))
  }
  return build("").slice(0, maxLength)
}

function stringifyJsonValue(input: unknown, maxLength: number) {
  if (input === undefined || input === null) return null
  if (typeof input === "string") {
    if (input.length > maxLength) return input.slice(0, maxLength)
    return input
  }

  const raw = JSON.stringify(input)
  if (raw.length <= maxLength) return raw

  if (input && typeof input === "object" && "logs" in input) {
    const payload = input as { logs?: unknown; lines?: unknown }
    if (typeof payload.logs === "string") {
      const lines =
        typeof payload.lines === "number" && Number.isInteger(payload.lines)
          ? payload.lines
          : undefined
      return trimTextToJsonLength(
        (logs) =>
          JSON.stringify({
            logs,
            lines,
            truncated: true,
          }),
        payload.logs,
        maxLength
      )
    }
  }

  return raw.slice(0, maxLength)
}

function parseTaskPayload(raw: string | null) {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ authPath: string }> }
) {
  const { authPath } = await params
  const rawBody = await request.text()
  let body: AgentSyncPayload
  try {
    body = rawBody ? (JSON.parse(rawBody) as AgentSyncPayload) : {}
  } catch {
    return jsonError("BAD_PAYLOAD", "请求体不合法", 400)
  }

  const db = getDb()
  const node = db
    .prepare(
      `SELECT id, name, status, agent_secret, agent_control_enabled
       FROM nodes
       WHERE auth_path = ?
       LIMIT 1`
    )
    .get(authPath) as NodeForAuth | undefined

  if (!node) return jsonError("NO_NODE", "未知节点", 404)
  if (node.agent_control_enabled === 0) {
    return jsonError("AGENT_CONTROL_DISABLED", "Agent 控制面已关闭", 403)
  }
  if (!node.agent_secret || node.agent_secret.length < 32) {
    return jsonError("AGENT_SECRET_MISSING", "Agent 密钥未初始化", 403)
  }

  const signature = verifyAgentRequestSignature({
    request,
    rawBody,
    agentSecret: node.agent_secret,
  })
  if (!signature.ok) {
    return jsonError("UNAUTHORIZED", "Agent 签名校验失败", 401)
  }
  if (
    !rememberAgentNonce({
      nodeId: node.id,
      nonce: signature.nonce,
      database: db,
    })
  ) {
    return jsonError("REPLAY_DETECTED", "重复请求", 409)
  }

  const agentVersion = normalizeString(body.agent_version, 64)
  const hostname = normalizeString(body.hostname, 128)
  const os = normalizeString(body.os, 64)
  const arch = normalizeString(body.arch, 64)
  const serviceManager = normalizeString(body.service_manager, 64)
  const hy2Status = normalizeOutputString(body.hy2_status, 64)
  const hy2Version = normalizeOutputString(body.hy2_version, 128)
  const hysteriaConfigPath = normalizeString(body.hysteria_config_path, 512)
  const hysteriaConfigHash = normalizeHash(body.hysteria_config_hash)
  const appliedConfigRevision = normalizeRevision(body.applied_config_revision)
  const lastConfigApplyAt = normalizeString(body.last_config_apply_at, 64)
  const lastError = normalizeMultilineString(body.last_error, 4096)
  const capabilities = normalizeCapabilities(body.capabilities)
  const taskResults = normalizeTaskResults(body.task_results)

  if (
    agentVersion === false ||
    hostname === false ||
    os === false ||
    arch === false ||
    serviceManager === false ||
    hy2Status === false ||
    hy2Version === false ||
    hysteriaConfigPath === false ||
    hysteriaConfigHash === false ||
    appliedConfigRevision === false ||
    lastConfigApplyAt === false ||
    lastError === false ||
    capabilities === false ||
    taskResults === false
  ) {
    return jsonError("BAD_PAYLOAD", "上报字段类型不合法", 400)
  }

  try {
    db.exec("BEGIN")

    db.prepare(
      `INSERT INTO node_agent_state(
         node_id, last_seen_at, agent_version, hostname, os, arch, service_manager,
         hy2_status, hy2_version, hysteria_config_path, hysteria_config_hash,
         applied_config_revision, last_config_apply_at, last_error, capabilities, updated_at
       ) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(node_id) DO UPDATE SET
         last_seen_at = datetime('now'),
         agent_version = COALESCE(excluded.agent_version, node_agent_state.agent_version),
         hostname = COALESCE(excluded.hostname, node_agent_state.hostname),
         os = COALESCE(excluded.os, node_agent_state.os),
         arch = COALESCE(excluded.arch, node_agent_state.arch),
         service_manager = COALESCE(excluded.service_manager, node_agent_state.service_manager),
         hy2_status = COALESCE(excluded.hy2_status, node_agent_state.hy2_status),
         hy2_version = COALESCE(excluded.hy2_version, node_agent_state.hy2_version),
         hysteria_config_path = COALESCE(excluded.hysteria_config_path, node_agent_state.hysteria_config_path),
         hysteria_config_hash = COALESCE(excluded.hysteria_config_hash, node_agent_state.hysteria_config_hash),
         applied_config_revision = COALESCE(excluded.applied_config_revision, node_agent_state.applied_config_revision),
         last_config_apply_at = COALESCE(excluded.last_config_apply_at, node_agent_state.last_config_apply_at),
         last_error = excluded.last_error,
         capabilities = COALESCE(excluded.capabilities, node_agent_state.capabilities),
         updated_at = datetime('now')`
    ).run(
      node.id,
      agentVersion,
      hostname,
      os,
      arch,
      serviceManager,
      hy2Status,
      hy2Version,
      hysteriaConfigPath,
      hysteriaConfigHash,
      appliedConfigRevision,
      lastConfigApplyAt,
      lastError,
      capabilities
    )

    const updateTask = db.prepare(
      `UPDATE node_agent_tasks
       SET status = ?, result = ?, error = ?, finished_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND node_id = ? AND status IN ('claimed','queued')`
    )

    for (const item of taskResults) {
      const id =
        typeof item.id === "number" && Number.isInteger(item.id) ? item.id : 0
      const status = normalizeTaskResultStatus(item.status)
      if (id <= 0 || status === false) continue
      updateTask.run(
        status,
        stringifyJsonValue(item.result, 16384),
        stringifyJsonValue(item.error, 4096),
        id,
        node.id
      )
    }

    db.exec("COMMIT")
  } catch {
    db.exec("ROLLBACK")
    return jsonError("INTERNAL", "处理失败", 500)
  }

  const desired = buildNodeDesiredConfig({
    nodeId: node.id,
    panelUrl: detectOrigin(request),
    database: db,
  })
  if (!desired) return jsonError("NO_NODE", "未知节点", 404)

  const currentRevision = normalizeRevision(body.current_config_revision)
  const normalizedCurrentRevision =
    currentRevision === false
      ? null
      : (currentRevision ?? appliedConfigRevision)
  const desiredRevision = desired.revision
  const desiredHash = desired.hy2ConfigHash
  const needsConfig =
    normalizedCurrentRevision !== desiredRevision ||
    !hysteriaConfigHash ||
    hysteriaConfigHash !== desiredHash

  const tasks = db
    .prepare(
      `SELECT id, type, payload
       FROM node_agent_tasks
       WHERE node_id = ?
         AND (
           status = 'queued'
           OR (status = 'claimed' AND lease_expires_at <= datetime('now'))
         )
       ORDER BY id ASC
       LIMIT 5`
    )
    .all(node.id) as ClaimedTask[]

  const claimedTasks = []
  if (needsConfig && !tasks.some((task) => task.type === "APPLY_CONFIG")) {
    claimedTasks.push({
      id: 0,
      type: "APPLY_CONFIG",
      payload: {
        yaml: desired.hy2Config,
        revision: desiredRevision,
        hash: desiredHash,
        config_path: desired.configPath,
        service_name: desired.serviceName,
      },
      lease_seconds: 300,
    })
  }

  for (const task of tasks) {
    if (!isAgentTaskType(task.type)) continue
    const leaseSeconds = getTaskLeaseSeconds(task.type)
    const result = db
      .prepare(
        `UPDATE node_agent_tasks
         SET status = 'claimed', claimed_at = datetime('now'),
             lease_expires_at = datetime('now', ?), updated_at = datetime('now')
         WHERE id = ? AND node_id = ? AND status IN ('queued','claimed')`
      )
      .run(`+${leaseSeconds} seconds`, task.id, node.id)
    if (result.changes > 0) {
      claimedTasks.push({
        id: task.id,
        type: task.type,
        payload:
          task.type === "APPLY_CONFIG"
            ? {
                yaml: desired.hy2Config,
                revision: desiredRevision,
                hash: desiredHash,
                config_path: desired.configPath,
                service_name: desired.serviceName,
              }
            : parseTaskPayload(task.payload),
        lease_seconds: leaseSeconds,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      server_time: new Date().toISOString(),
      control_enabled: true,
      desired_config: {
        revision: desiredRevision,
        hash: desiredHash,
        needs_apply: needsConfig,
        config_path: desired.configPath,
        service_name: desired.serviceName,
      },
      agent_config: {
        interval_seconds: desired.intervalSeconds,
        auto_update_enabled: desired.node.agent_auto_update_enabled !== 0,
        hy2_auto_update_enabled: desired.node.hy2_auto_update_enabled !== 0,
        hysteria_stats_url: "http://127.0.0.1:9999",
        hysteria_stats_secret: desired.hy2StatsSecret,
      },
      tasks: claimedTasks,
    },
  })
}
