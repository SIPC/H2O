"use client"

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { Minus, Plus, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { useConfirm } from "@/components/confirm-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  BUILTIN_SUBSCRIPTION_RULE_IDS,
  BUILTIN_SUBSCRIPTION_RULE_LABELS,
  BUILTIN_SUBSCRIPTION_RULE_PREVIEW_LINES,
  DEFAULT_BUILTIN_RULE_TARGETS,
  type BuiltinSubscriptionRuleId,
} from "@/lib/subscription/rule-ui-constants"
import type {
  ClashRuleBehavior,
  SingboxRuleSetFormat,
  SubscriptionPolicyGroup,
  SubscriptionRemoteRuleSet,
  SubscriptionRule,
  SubscriptionRuleConfig,
  SubscriptionRuleTarget,
  SubscriptionRuleType,
  SubscriptionPolicyGroupType,
} from "@/lib/subscription/rule-config"

type AvailableNode = {
  id: number
  name: string
  status: "enabled" | "disabled"
}

type PolicyGroupDraft = SubscriptionPolicyGroup
type RuleDraft = SubscriptionRule
type RuleSetDraft = SubscriptionRemoteRuleSet

type EditingPolicyGroup = {
  index: number | null
  draft: PolicyGroupDraft
} | null
type EditingBuiltinPolicy = {
  target: SubscriptionRuleTarget
  draft: PolicyGroupDraft
} | null
type EditingBuiltinRule = {
  id: BuiltinSubscriptionRuleId
  enabled: boolean
  target: SubscriptionRuleTarget
} | null
type EditingFallbackRule = { target: SubscriptionRuleTarget } | null
type EditingRule = { index: number | null; draft: RuleDraft } | null
type EditingRuleSet = { index: number | null; draft: RuleSetDraft } | null

const DEFAULT_CONFIG: SubscriptionRuleConfig = {
  enabled: true,
  mode: "prepend",
  finalTarget: "fallback",
  builtinPolicyOverrides: {},
  builtinRuleOverrides: {},
  policyGroups: [],
  rules: [],
  remoteRuleSets: [],
}

const RULE_TYPE_LABELS: Record<SubscriptionRuleType, string> = {
  domain: "完整域名",
  domain_suffix: "域名后缀",
  domain_keyword: "域名关键字",
  ip_cidr: "IP-CIDR",
  geoip: "GEOIP",
}

const TARGET_LABELS: Record<SubscriptionRuleTarget, string> = {
  proxy: "节点选择",
  auto: "自动选择",
  ai: "AI",
  media: "国际媒体",
  telegram: "Telegram",
  apple: "苹果服务",
  microsoft: "微软服务",
  direct: "直连",
  reject: "拒绝",
  fallback: "漏网之鱼",
}

const POLICY_GROUP_TYPE_LABELS: Record<SubscriptionPolicyGroupType, string> = {
  select: "手动选择",
  "url-test": "自动测速",
}

const CLASH_BEHAVIOR_LABELS: Record<ClashRuleBehavior, string> = {
  domain: "domain",
  ipcidr: "ipcidr",
  classical: "classical",
}

const SINGBOX_FORMAT_LABELS: Record<SingboxRuleSetFormat, string> = {
  binary: "binary (.srs)",
  source: "source",
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function newBuiltinPolicyDraft(
  target: SubscriptionRuleTarget,
  override?: SubscriptionPolicyGroup
): PolicyGroupDraft {
  if (override) return structuredClone(override)
  const name = targetLabel(target, [])
  const proxyBased = [
    "ai",
    "media",
    "telegram",
    "apple",
    "microsoft",
    "fallback",
  ].includes(String(target))
  const nodeBased = !proxyBased && target !== "direct" && target !== "reject"
  return {
    id: String(target),
    enabled: true,
    name,
    type: target === "auto" ? "url-test" : "select",
    includeNodes: nodeBased,
    selectedNodeIds: [],
    includeProxy: proxyBased,
    includeAuto: target === "proxy",
    includeDirect:
      !proxyBased &&
      ["proxy", "apple", "microsoft", "direct", "fallback"].includes(
        String(target)
      ),
    includeReject: target === "reject",
    url: "http://www.gstatic.com/generate_204",
    interval: 300,
    tolerance: 50,
  }
}

function newPolicyGroupDraft(): PolicyGroupDraft {
  return {
    id: createId("policy"),
    enabled: true,
    name: "自定义策略",
    type: "select",
    includeNodes: true,
    selectedNodeIds: [],
    includeProxy: false,
    includeAuto: false,
    includeDirect: true,
    includeReject: false,
    url: "http://www.gstatic.com/generate_204",
    interval: 300,
    tolerance: 50,
  }
}

function newRuleDraft(): RuleDraft {
  return {
    id: createId("rule"),
    enabled: true,
    name: "",
    type: "domain_suffix",
    value: "",
    target: "proxy",
    noResolve: false,
  }
}

function newRuleSetDraft(): RuleSetDraft {
  return {
    id: createId("ruleset"),
    enabled: true,
    name: "",
    target: "proxy",
    clash: {
      enabled: true,
      behavior: "classical",
      url: "",
    },
    singbox: {
      enabled: false,
      format: "binary",
      url: "",
    },
    noResolve: false,
  }
}

function cloneConfig(config: SubscriptionRuleConfig): SubscriptionRuleConfig {
  return structuredClone(config)
}

function normalizePolicyGroupPaths(
  group: SubscriptionPolicyGroup
): SubscriptionPolicyGroup {
  if (group.includeProxy) {
    return {
      ...group,
      includeNodes: false,
      selectedNodeIds: [],
      includeAuto: false,
      includeDirect: false,
      includeReject: false,
    }
  }

  const hasSpecificNodes = group.selectedNodeIds.length > 0
  return {
    ...group,
    includeNodes: hasSpecificNodes ? true : group.includeNodes,
    includeAuto: hasSpecificNodes ? false : group.includeAuto,
    includeReject:
      group.includeDirect && group.includeReject && group.id !== "reject"
        ? false
        : group.includeReject,
    includeDirect:
      group.includeDirect && group.includeReject && group.id === "reject"
        ? false
        : group.includeDirect,
  }
}

function targetLabel(
  target: SubscriptionRuleTarget,
  policyGroups: SubscriptionPolicyGroup[],
  builtinPolicyOverrides: SubscriptionRuleConfig["builtinPolicyOverrides"] = {}
) {
  return (
    builtinPolicyOverrides[target as keyof typeof builtinPolicyOverrides]
      ?.name ??
    TARGET_LABELS[target as keyof typeof TARGET_LABELS] ??
    policyGroups.find((group) => group.id === target)?.name ??
    target
  )
}

function ruleSummary(rule: SubscriptionRule) {
  return `${RULE_TYPE_LABELS[rule.type]}：${rule.value}`
}

function ruleSetSummary(ruleSet: SubscriptionRemoteRuleSet) {
  const formats: string[] = []
  if (ruleSet.clash?.enabled) formats.push("Clash")
  if (ruleSet.singbox?.enabled) formats.push("sing-box")
  return formats.length ? formats.join(" / ") : "未启用客户端"
}

function RuleTargetSelect({
  value,
  policyGroups,
  onChange,
}: {
  value: SubscriptionRuleTarget
  policyGroups: SubscriptionPolicyGroup[]
  onChange: (value: SubscriptionRuleTarget) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as SubscriptionRuleTarget)}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          {Object.entries(TARGET_LABELS).map(([target, label]) => (
            <SelectItem key={target} value={target}>
              {label}
            </SelectItem>
          ))}
          {policyGroups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name || group.id}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function PolicyGroupForm({
  draft,
  availableNodes,
  idReadonly = false,
  setDraft,
  onSubmit,
  onDelete,
}: {
  draft: PolicyGroupDraft
  availableNodes: AvailableNode[]
  idReadonly?: boolean
  setDraft: (draft: PolicyGroupDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onDelete?: () => void
}) {
  const hasSpecificNodes = draft.selectedNodeIds.length > 0
  const proxySelected = draft.includeProxy
  const autoDisabled = proxySelected || hasSpecificNodes
  const allNodesDisabled = proxySelected || hasSpecificNodes
  const allNodesSelected =
    draft.includeNodes && draft.selectedNodeIds.length === 0
  const specificNodesDisabled =
    proxySelected || draft.includeAuto || allNodesSelected
  const directDisabled = proxySelected || draft.includeReject
  const rejectDisabled = proxySelected || draft.includeDirect

  function toggleNode(nodeId: number, checked: boolean) {
    const selected = new Set(draft.selectedNodeIds)
    if (checked) selected.add(nodeId)
    else selected.delete(nodeId)
    const selectedNodeIds = Array.from(selected)
    setDraft({
      ...draft,
      includeNodes: selectedNodeIds.length > 0,
      selectedNodeIds,
      includeAuto: selectedNodeIds.length > 0 ? false : draft.includeAuto,
    })
  }

  function toggleAllNodes(checked: boolean) {
    setDraft({
      ...draft,
      includeNodes: checked,
      selectedNodeIds: [],
    })
  }

  function toggleProxy(checked: boolean) {
    setDraft(
      checked
        ? {
            ...draft,
            includeProxy: true,
            includeNodes: false,
            selectedNodeIds: [],
            includeAuto: false,
            includeDirect: false,
            includeReject: false,
          }
        : { ...draft, includeProxy: false }
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-id">策略 ID</Label>
          <Input
            id="policy-id"
            value={draft.id}
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            placeholder="game"
            disabled={idReadonly}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-name">策略名称</Label>
          <Input
            id="policy-name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="🎮 游戏"
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>策略类型</Label>
        <Select
          value={draft.type}
          onValueChange={(type) =>
            setDraft({ ...draft, type: type as SubscriptionPolicyGroupType })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              {Object.entries(POLICY_GROUP_TYPE_LABELS).map(([type, label]) => (
                <SelectItem key={type} value={type}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            下级路径
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            选择这个策略组可以继续流向哪些出口。选择“全部节点”表示使用用户订阅内所有可用节点；选择具体节点则只使用这些节点。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2">
              <Checkbox
                checked={draft.includeProxy}
                onCheckedChange={(checked) => toggleProxy(checked === true)}
              />
              <span className="text-sm">节点选择</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2">
              <Checkbox
                checked={draft.includeAuto}
                disabled={autoDisabled}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, includeAuto: checked === true })
                }
              />
              <span className="text-sm">自动选择</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2">
              <Checkbox
                checked={allNodesSelected}
                disabled={allNodesDisabled}
                onCheckedChange={(checked) => toggleAllNodes(checked === true)}
              />
              <span className="text-sm">全部节点</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2">
              <Checkbox
                checked={draft.includeDirect}
                disabled={directDisabled}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, includeDirect: checked === true })
                }
              />
              <span className="text-sm">直连 DIRECT / direct</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2">
              <Checkbox
                checked={draft.includeReject}
                disabled={rejectDisabled}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, includeReject: checked === true })
                }
              />
              <span className="text-sm">拦截 REJECT / reject</span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <Label>指定节点</Label>
            {availableNodes.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {availableNodes.map((node) => (
                  <label
                    key={node.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border p-2"
                  >
                    <Checkbox
                      checked={draft.selectedNodeIds.includes(node.id)}
                      disabled={specificNodesDisabled}
                      onCheckedChange={(checked) =>
                        toggleNode(node.id, checked === true)
                      }
                    />
                    <span className="min-w-0 text-sm">
                      {node.name}
                      {node.status === "disabled" ? "（已禁用）" : ""}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                暂无可选节点。
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {draft.type === "url-test" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-2 sm:col-span-3">
            <Label htmlFor="policy-url">测速 URL</Label>
            <Input
              id="policy-url"
              value={draft.url}
              onChange={(event) =>
                setDraft({ ...draft, url: event.target.value })
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="policy-interval">间隔秒</Label>
            <Input
              id="policy-interval"
              type="number"
              min={30}
              max={86400}
              value={draft.interval}
              onChange={(event) =>
                setDraft({ ...draft, interval: Number(event.target.value) })
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="policy-tolerance">容差</Label>
            <Input
              id="policy-tolerance"
              type="number"
              min={0}
              max={1000}
              value={draft.tolerance}
              onChange={(event) =>
                setDraft({ ...draft, tolerance: Number(event.target.value) })
              }
            />
          </div>
        </div>
      ) : null}

      <label className="flex cursor-pointer items-center gap-3">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        />
        <span className="text-sm">启用此策略组</span>
      </label>

      <SheetFooter className="flex-row justify-between px-0">
        {onDelete ? (
          <Button type="button" variant="destructive" onClick={onDelete}>
            删除策略组
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit">保存策略组</Button>
      </SheetFooter>
    </form>
  )
}

function RuleForm({
  draft,
  policyGroups,
  setDraft,
  onSubmit,
  onDelete,
}: {
  draft: RuleDraft
  policyGroups: SubscriptionPolicyGroup[]
  setDraft: (draft: RuleDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onDelete?: () => void
}) {
  const noResolveVisible = draft.type === "ip_cidr" || draft.type === "geoip"

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-name">规则名称</Label>
        <Input
          id="rule-name"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder="可选，仅管理员可见"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>规则类型</Label>
          <Select
            value={draft.type}
            onValueChange={(next) =>
              setDraft({ ...draft, type: next as SubscriptionRuleType })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {Object.entries(RULE_TYPE_LABELS).map(([type, label]) => (
                  <SelectItem key={type} value={type}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>目标策略</Label>
          <RuleTargetSelect
            value={draft.target}
            policyGroups={policyGroups}
            onChange={(target) => setDraft({ ...draft, target })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-value">规则内容</Label>
        <Input
          id="rule-value"
          value={draft.value}
          onChange={(event) =>
            setDraft({ ...draft, value: event.target.value })
          }
          placeholder="example.com / openai / 1.1.1.1/32 / CN"
          required
        />
        <p className="text-xs text-muted-foreground">
          GEOIP 第一版仅支持 CN；IP-CIDR 支持 IPv4 / IPv6 CIDR。
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        />
        <span className="text-sm">启用此规则</span>
      </label>

      {noResolveVisible ? (
        <label className="flex cursor-pointer items-center gap-3">
          <Checkbox
            checked={draft.noResolve === true}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, noResolve: checked === true })
            }
          />
          <span className="text-sm">Clash 输出 no-resolve</span>
        </label>
      ) : null}

      <SheetFooter className="flex-row justify-between px-0">
        {onDelete ? (
          <Button type="button" variant="destructive" onClick={onDelete}>
            删除规则
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit">保存规则</Button>
      </SheetFooter>
    </form>
  )
}

function RuleSetForm({
  draft,
  policyGroups,
  setDraft,
  onSubmit,
  onDelete,
}: {
  draft: RuleSetDraft
  policyGroups: SubscriptionPolicyGroup[]
  setDraft: (draft: RuleSetDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onDelete?: () => void
}) {
  const clash = draft.clash ?? {
    enabled: false,
    behavior: "classical" as const,
    url: "",
  }
  const singbox = draft.singbox ?? {
    enabled: false,
    format: "binary" as const,
    url: "",
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ruleset-id">远程规则 ID</Label>
          <Input
            id="ruleset-id"
            value={draft.id}
            onChange={(event) => setDraft({ ...draft, id: event.target.value })}
            placeholder="my_proxy"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ruleset-name">显示名称</Label>
          <Input
            id="ruleset-name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="可选，仅管理员可见"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>目标策略</Label>
        <RuleTargetSelect
          value={draft.target}
          policyGroups={policyGroups}
          onChange={(target) => setDraft({ ...draft, target })}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        />
        <span className="text-sm">启用此远程规则</span>
      </label>

      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            Clash Rule Provider
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3">
            <Switch
              checked={clash.enabled}
              onCheckedChange={(enabled) =>
                setDraft({ ...draft, clash: { ...clash, enabled } })
              }
            />
            <span className="text-sm">输出到 Clash / Mihomo</span>
          </label>
          <div className="flex flex-col gap-2">
            <Label>behavior</Label>
            <Select
              value={clash.behavior}
              onValueChange={(behavior) =>
                setDraft({
                  ...draft,
                  clash: { ...clash, behavior: behavior as ClashRuleBehavior },
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  {Object.entries(CLASH_BEHAVIOR_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ruleset-clash-url">Clash URL</Label>
            <Input
              id="ruleset-clash-url"
              value={clash.url}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  clash: { ...clash, url: event.target.value },
                })
              }
              placeholder="https://example.com/rules.yaml"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-1">
          <CardTitle className="text-base leading-none font-semibold">
            sing-box Rule Set
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3">
            <Switch
              checked={singbox.enabled}
              onCheckedChange={(enabled) =>
                setDraft({ ...draft, singbox: { ...singbox, enabled } })
              }
            />
            <span className="text-sm">输出到 sing-box</span>
          </label>
          <div className="flex flex-col gap-2">
            <Label>format</Label>
            <Select
              value={singbox.format}
              onValueChange={(format) =>
                setDraft({
                  ...draft,
                  singbox: {
                    ...singbox,
                    format: format as SingboxRuleSetFormat,
                  },
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  {Object.entries(SINGBOX_FORMAT_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    )
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ruleset-singbox-url">sing-box URL</Label>
            <Input
              id="ruleset-singbox-url"
              value={singbox.url}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  singbox: { ...singbox, url: event.target.value },
                })
              }
              placeholder="https://example.com/rules.srs"
            />
          </div>
        </CardContent>
      </Card>

      <label className="flex cursor-pointer items-center gap-3">
        <Checkbox
          checked={draft.noResolve === true}
          onCheckedChange={(checked) =>
            setDraft({ ...draft, noResolve: checked === true })
          }
        />
        <span className="text-sm">Clash RULE-SET 输出 no-resolve</span>
      </label>

      <SheetFooter className="flex-row justify-between px-0">
        {onDelete ? (
          <Button type="button" variant="destructive" onClick={onDelete}>
            删除远程规则
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit">保存远程规则</Button>
      </SheetFooter>
    </form>
  )
}

function FlowCanvasNode({
  x,
  y,
  width = 220,
  children,
  onClick,
  onHoverChange,
}: {
  x: number
  y: number
  width?: number
  children: ReactNode
  onClick?: () => void
  onHoverChange?: (active: boolean) => void
}) {
  const Component = onClick ? "button" : "div"
  return (
    <Component
      type={onClick ? "button" : undefined}
      className="absolute rounded-xl border bg-background p-3 text-left shadow-sm transition hover:bg-muted/40"
      style={{ left: x, top: y, width }}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      {children}
    </Component>
  )
}

function FlowView({
  config,
  availableNodes,
  dirty,
  saving,
  onSave,
  onPreviewClash,
  onPreviewSingbox,
  onAddRule,
  onEditRule,
  onAddRuleSet,
  onEditRuleSet,
  onAddPolicyGroup,
  onEditPolicyGroup,
  onEditBuiltinPolicy,
  onEditBuiltinRule,
  onEditFallbackRule,
}: {
  config: SubscriptionRuleConfig
  availableNodes: AvailableNode[]
  dirty: boolean
  saving: boolean
  onSave: () => void
  onPreviewClash: () => void
  onPreviewSingbox: () => void
  onAddRule: () => void
  onEditRule: (index: number) => void
  onAddRuleSet: () => void
  onEditRuleSet: (index: number) => void
  onAddPolicyGroup: () => void
  onEditPolicyGroup: (index: number) => void
  onEditBuiltinPolicy: (target: SubscriptionRuleTarget) => void
  onEditBuiltinRule: (rule: NonNullable<EditingBuiltinRule>) => void
  onEditFallbackRule: (target: SubscriptionRuleTarget) => void
}) {
  const [pan, setPan] = useState({ x: 24, y: 24 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [activeCardKey, setActiveCardKey] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    }
    setDragging(true)
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    setPan({
      x: current.originX + event.clientX - current.startX,
      y: current.originY + event.clientY - current.startY,
    })
  }

  function handleCanvasPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (current?.pointerId === event.pointerId) {
      dragRef.current = null
      setDragging(false)
    }
  }

  function clampZoom(value: number) {
    return Math.min(1.6, Math.max(0.55, Number(value.toFixed(2))))
  }

  function applyZoomDelta(delta: number, origin?: { x: number; y: number }) {
    const nextZoom = clampZoom(zoom + delta)
    if (nextZoom === zoom) return

    if (origin) {
      const worldX = (origin.x - pan.x) / zoom
      const worldY = (origin.y - pan.y) / zoom
      setPan({
        x: origin.x - worldX * nextZoom,
        y: origin.y - worldY * nextZoom,
      })
    }
    setZoom(nextZoom)
  }

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const canvasElement = element

    function handleNativeWheel(event: globalThis.WheelEvent) {
      event.preventDefault()
      const bounds = canvasElement.getBoundingClientRect()
      const currentPan = panRef.current
      const currentZoom = zoomRef.current
      const nextZoom = clampZoom(
        currentZoom + (event.deltaY > 0 ? -0.08 : 0.08)
      )
      if (nextZoom === currentZoom) return

      const origin = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }
      const worldX = (origin.x - currentPan.x) / currentZoom
      const worldY = (origin.y - currentPan.y) / currentZoom
      const nextPan = {
        x: origin.x - worldX * nextZoom,
        y: origin.y - worldY * nextZoom,
      }

      panRef.current = nextPan
      zoomRef.current = nextZoom
      setPan(nextPan)
      setZoom(nextZoom)
    }

    canvasElement.addEventListener("wheel", handleNativeWheel, {
      passive: false,
    })
    return () => canvasElement.removeEventListener("wheel", handleNativeWheel)
  }, [])

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false
      return Boolean(
        target.closest("input, textarea, select, [contenteditable='true']")
      )
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isEditableTarget(event.target)) {
        return
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault()
        setZoom((current) => clampZoom(current - 0.1))
        return
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault()
        setZoom((current) => clampZoom(current + 0.1))
        return
      }
      if (event.key === "0") {
        event.preventDefault()
        setPan({ x: 24, y: 24 })
        setZoom(1)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  type RuleFlowItem = {
    key: string
    label: string
    subtitle: string
    target: SubscriptionRuleTarget
    badge: string
    onClick?: () => void
  }
  type PolicyFlowItem = {
    target: SubscriptionRuleTarget
    label: string
    subtitle: string
    onClick?: () => void
  }

  const builtinRuleItems: RuleFlowItem[] =
    config.mode === "replace"
      ? []
      : BUILTIN_SUBSCRIPTION_RULE_IDS.flatMap((id) => {
          const override = config.builtinRuleOverrides[id]
          if (override?.enabled === false) return []
          const label = BUILTIN_SUBSCRIPTION_RULE_LABELS[id]
          return [
            {
              key: `builtin:${id}`,
              label: label.name,
              subtitle: label.description,
              target: override?.target ?? DEFAULT_BUILTIN_RULE_TARGETS[id],
              badge: "内置规则",
              onClick: () =>
                onEditBuiltinRule({
                  id,
                  enabled: override?.enabled !== false,
                  target: override?.target ?? DEFAULT_BUILTIN_RULE_TARGETS[id],
                }),
            },
          ]
        })

  const customRuleItems: RuleFlowItem[] = [
    ...config.remoteRuleSets.map((ruleSet, index) => ({
      key: `ruleset:${ruleSet.id}`,
      label: ruleSet.name || ruleSet.id,
      subtitle: ruleSetSummary(ruleSet),
      target: ruleSet.target,
      badge: "远程规则",
      onClick: () => onEditRuleSet(index),
    })),
    ...config.rules.map((rule, index) => ({
      key: `rule:${rule.id}`,
      label: rule.name || ruleSummary(rule),
      subtitle: ruleSummary(rule),
      target: rule.target,
      badge: `规则 ${index + 1}`,
      onClick: () => onEditRule(index),
    })),
  ]

  const policyItems: PolicyFlowItem[] = [
    ...Object.entries(TARGET_LABELS)
      .filter(
        ([target]) =>
          config.builtinPolicyOverrides[
            target as keyof typeof config.builtinPolicyOverrides
          ]?.enabled !== false
      )
      .map(([target]) => ({
        target,
        label: targetLabel(
          target,
          config.policyGroups,
          config.builtinPolicyOverrides
        ),
        subtitle: config.builtinPolicyOverrides[
          target as keyof typeof config.builtinPolicyOverrides
        ]
          ? "内置策略 · 已自定义"
          : "内置订阅策略",
        onClick: () => onEditBuiltinPolicy(target),
      })),
    ...config.policyGroups.map((group, index) => ({
      target: group.id,
      label: group.name || group.id,
      subtitle: `${POLICY_GROUP_TYPE_LABELS[group.type]} · ${
        group.includeNodes
          ? group.selectedNodeIds.length > 0
            ? `指定 ${group.selectedNodeIds.length} 节点`
            : "全部节点"
          : group.includeProxy
            ? "节点选择"
            : "不含节点"
      }`,
      onClick: () => onEditPolicyGroup(index),
    })),
  ]
  if (policyItems.length === 0) {
    policyItems.push({
      target: config.finalTarget,
      label: targetLabel(
        config.finalTarget,
        config.policyGroups,
        config.builtinPolicyOverrides
      ),
      subtitle: "兜底策略",
    })
  }

  const policyIndex = new Map(
    policyItems.map((item, index) => [item.target, index])
  )
  const fallbackPolicyAvailable = policyIndex.has("fallback")
  const effectiveFinalTarget = policyIndex.has(config.finalTarget)
    ? config.finalTarget
    : fallbackPolicyAvailable
      ? "fallback"
      : "proxy"
  const ruleItems: RuleFlowItem[] = [
    ...builtinRuleItems.filter((item) => policyIndex.has(item.target)),
    ...customRuleItems.filter((item) => policyIndex.has(item.target)),
    {
      key: "fallback",
      label: "未匹配流量",
      subtitle: "所有未命中上方规则的请求",
      target: effectiveFinalTarget,
      badge: "兜底",
      onClick: () => onEditFallbackRule(effectiveFinalTarget),
    },
  ]
  type OutputFlowItem = {
    key: string
    label: string
    subtitle: string
  }
  type PolicyOutputLink = {
    key: string
    policyTarget: string
    outputKey: string
  }

  function resolvePolicyGroup(policy: PolicyFlowItem) {
    const customGroup = config.policyGroups.find(
      (item) => item.id === policy.target
    )
    return (
      customGroup ??
      (policy.target in TARGET_LABELS
        ? newBuiltinPolicyDraft(
            policy.target as SubscriptionRuleTarget,
            config.builtinPolicyOverrides[
              policy.target as keyof typeof config.builtinPolicyOverrides
            ]
          )
        : null)
    )
  }

  const outputItems: OutputFlowItem[] = []
  const outputKeys = new Set<string>()
  const policyOutputLinks: PolicyOutputLink[] = []
  function addOutput(item: OutputFlowItem) {
    if (outputKeys.has(item.key)) return
    outputKeys.add(item.key)
    outputItems.push(item)
  }
  function linkOutput(policyTarget: string, item: OutputFlowItem) {
    addOutput(item)
    policyOutputLinks.push({
      key: `policy-output:${policyTarget}:${item.key}:${policyOutputLinks.length}`,
      policyTarget,
      outputKey: item.key,
    })
  }

  policyItems.forEach((policy) => {
    const group = resolvePolicyGroup(policy)
    if (!group?.enabled) return

    if (group.includeNodes) {
      const selectedNodes =
        group.selectedNodeIds.length > 0
          ? availableNodes.filter((node) =>
              group.selectedNodeIds.includes(node.id)
            )
          : availableNodes

      if (selectedNodes.length > 0) {
        selectedNodes.forEach((node) => {
          linkOutput(String(policy.target), {
            key: `node:${node.id}`,
            label: node.name,
            subtitle: "节点出口",
          })
        })
      } else {
        linkOutput(String(policy.target), {
          key: group.selectedNodeIds.length > 0 ? "missing-node" : "empty-node",
          label:
            group.selectedNodeIds.length > 0
              ? "已选节点不可用"
              : "暂无可用节点",
          subtitle: "节点出口",
        })
      }
    }

    if (group.includeProxy) {
      linkOutput(String(policy.target), {
        key: "proxy",
        label: "节点选择",
        subtitle: "策略出口",
      })
    }
    if (group.includeAuto) {
      linkOutput(String(policy.target), {
        key: "auto",
        label: "自动选择",
        subtitle: "策略出口",
      })
    }
    if (group.includeDirect) {
      linkOutput(String(policy.target), {
        key: "direct",
        label: "DIRECT / direct",
        subtitle: "直连出口",
      })
    }
    if (group.includeReject) {
      linkOutput(String(policy.target), {
        key: "reject",
        label: "REJECT / reject",
        subtitle: "拒绝出口",
      })
    }
  })

  const canvasTopPadding = 96
  const rowGap = 32
  const inputWidth = 220
  const ruleWidth = 260
  const policyWidth = 250
  const outputWidth = 240
  const inputHeight = 104
  const ruleHeight = 104
  const policyHeight = 104
  const outputHeight = 96
  const stackLayout = <T,>(items: T[], getHeight: (item: T) => number) => {
    let y = canvasTopPadding
    return items.map((item) => {
      const height = getHeight(item)
      const layout = { y, height }
      y += height + rowGap
      return layout
    })
  }
  const ruleLayout = stackLayout(ruleItems, () => ruleHeight)
  const policyRowLayout = stackLayout(policyItems, () => policyHeight)
  const outputLayout = stackLayout(outputItems, () => outputHeight)
  const outputIndex = new Map(
    outputItems.map((item, index) => [item.key, index])
  )
  const canvasHeight = Math.max(
    560,
    ruleLayout.at(-1)
      ? ruleLayout.at(-1)!.y + ruleLayout.at(-1)!.height + 96
      : canvasTopPadding + 240,
    policyRowLayout.at(-1)
      ? policyRowLayout.at(-1)!.y + policyRowLayout.at(-1)!.height + 96
      : canvasTopPadding + 240,
    outputLayout.at(-1)
      ? outputLayout.at(-1)!.y + outputLayout.at(-1)!.height + 96
      : canvasTopPadding + 240
  )
  const canvasWidth = 1480
  const entry = {
    x: 40,
    y: Math.max(120, canvasHeight / 2 - inputHeight / 2),
    w: inputWidth,
  }
  const ruleX = 340
  const policyX = 760
  const outputX = 1160

  function changeZoom(delta: number) {
    applyZoomDelta(delta)
  }

  function resetViewport() {
    setPan({ x: 24, y: 24 })
    setZoom(1)
  }

  function rightCenter(x: number, y: number, width: number, height: number) {
    return { x: x + width, y: y + height / 2 }
  }

  function leftCenter(x: number, y: number, height: number) {
    return { x, y: y + height / 2 }
  }

  function elbowPath(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) {
    const midX = from.x + (to.x - from.x) / 2
    const radius = Math.min(
      12,
      Math.abs(to.x - from.x) / 4,
      Math.abs(to.y - from.y) / 2
    )
    if (radius <= 0) {
      return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`
    }

    const verticalDirection = to.y > from.y ? 1 : -1
    return [
      `M ${from.x} ${from.y}`,
      `H ${midX - radius}`,
      `Q ${midX} ${from.y} ${midX} ${from.y + radius * verticalDirection}`,
      `V ${to.y - radius * verticalDirection}`,
      `Q ${midX} ${to.y} ${midX + radius} ${to.y}`,
      `H ${to.x}`,
    ].join(" ")
  }

  function ruleCardKey(item: RuleFlowItem) {
    return `rule-card:${item.key}`
  }

  function policyCardKey(target: string) {
    return `policy-card:${target}`
  }

  function outputCardKey(key: string) {
    return `output-card:${key}`
  }

  function activeOutputPolicyTargets(outputKey: string) {
    return policyOutputLinks
      .filter((link) => link.outputKey === outputKey)
      .map((link) => link.policyTarget)
  }

  function isRulePathActive(item: RuleFlowItem) {
    if (!activeCardKey) return false
    if (activeCardKey === "input") return true
    if (activeCardKey === ruleCardKey(item)) return true
    if (activeCardKey === policyCardKey(String(item.target))) return true
    if (activeCardKey.startsWith("output-card:")) {
      const outputKey = activeCardKey.replace("output-card:", "")
      return activeOutputPolicyTargets(outputKey).includes(String(item.target))
    }
    return false
  }

  function isPolicyOutputPathActive(link: PolicyOutputLink) {
    if (!activeCardKey) return false
    if (activeCardKey === "input") {
      return ruleItems.some((item) => String(item.target) === link.policyTarget)
    }
    if (activeCardKey === policyCardKey(link.policyTarget)) return true
    if (activeCardKey === outputCardKey(link.outputKey)) return true
    return ruleItems.some(
      (item) =>
        activeCardKey === ruleCardKey(item) &&
        String(item.target) === link.policyTarget
    )
  }

  function renderFlowLine(
    key: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    active: boolean
  ) {
    const strokeWidth = active ? 2 : 1.25
    const arrowSize = 6
    const lineEnd = { x: to.x - arrowSize, y: to.y }
    return (
      <g key={key} className={active ? "text-primary" : "text-border"}>
        <path
          d={elbowPath(from, lineEnd)}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={`M ${to.x - arrowSize} ${to.y - 4} L ${to.x} ${to.y} L ${to.x - arrowSize} ${to.y + 4}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    )
  }

  return (
    <div
      ref={canvasRef}
      className={
        dragging
          ? "relative h-[calc(100svh-3rem)] cursor-grabbing overflow-hidden bg-muted/20 select-none"
          : "relative h-[calc(100svh-3rem)] cursor-grab overflow-hidden bg-muted/20 select-none"
      }
      style={{
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 18%, transparent) 1px, transparent 1px)",
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        backgroundSize: `${18 * zoom}px ${18 * zoom}px`,
      }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerEnd}
      onPointerCancel={handleCanvasPointerEnd}
    >
      <ButtonGroup
        aria-label="画布新增操作"
        className="absolute top-3 left-3 z-10 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button size="sm" onClick={onAddRule}>
          <Plus data-icon="inline-start" />
          规则
        </Button>
        <Button size="sm" variant="outline" onClick={onAddRuleSet}>
          <Plus data-icon="inline-start" />
          远程规则
        </Button>
        <Button size="sm" variant="outline" onClick={onAddPolicyGroup}>
          <Plus data-icon="inline-start" />
          策略组
        </Button>
      </ButtonGroup>

      <ButtonGroup
        aria-label="画布缩放控制"
        className="absolute bottom-3 left-3 z-10 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="缩小画布"
          title="缩小"
          onClick={() => changeZoom(-0.1)}
        >
          <Minus />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="重置画布"
          title="重置"
          onClick={() => resetViewport()}
        >
          <RotateCcw />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="放大画布"
          title="放大"
          onClick={() => changeZoom(0.1)}
        >
          <Plus />
        </Button>
      </ButtonGroup>

      <ButtonGroup
        aria-label="画布页面操作"
        className="absolute top-3 right-3 z-10 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button size="sm" variant="outline" onClick={onPreviewClash}>
          预览 Clash
        </Button>
        <Button size="sm" variant="outline" onClick={onPreviewSingbox}>
          预览 sing-box
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </ButtonGroup>

      <div
        className="absolute top-0 left-0"
        style={{
          width: canvasWidth,
          height: canvasHeight,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={canvasWidth}
          height={canvasHeight}
        >
          {ruleItems.map((item, index) => {
            const { y, height } = ruleLayout[index]
            const from = rightCenter(entry.x, entry.y, entry.w, inputHeight)
            const to = leftCenter(ruleX, y, height)
            return renderFlowLine(
              `entry-line-${item.key}`,
              from,
              to,
              isRulePathActive(item)
            )
          })}
          {ruleItems.map((item, index) => {
            const { y, height } = ruleLayout[index]
            const policyLayout =
              policyRowLayout[policyIndex.get(item.target) ?? 0]
            const from = rightCenter(ruleX, y, ruleWidth, height)
            const to = leftCenter(policyX, policyLayout.y, policyHeight)
            return renderFlowLine(
              `rule-line-${item.key}`,
              from,
              to,
              isRulePathActive(item)
            )
          })}
          {policyOutputLinks.map((link) => {
            const policyLayout =
              policyRowLayout[policyIndex.get(link.policyTarget) ?? 0]
            const outputLayoutItem =
              outputLayout[outputIndex.get(link.outputKey) ?? 0]
            const from = rightCenter(
              policyX,
              policyLayout.y,
              policyWidth,
              policyHeight
            )
            const to = leftCenter(outputX, outputLayoutItem.y, outputHeight)
            return renderFlowLine(
              link.key,
              from,
              to,
              isPolicyOutputPathActive(link)
            )
          })}
        </svg>

        <FlowCanvasNode
          x={entry.x}
          y={entry.y}
          width={entry.w}
          onHoverChange={(active) => setActiveCardKey(active ? "input" : null)}
        >
          <Badge>INPUT</Badge>
          <p className="mt-2 text-sm font-semibold">流量入口</p>
          <p className="mt-1 text-xs text-muted-foreground">
            订阅客户端请求从这里进入规则匹配。
          </p>
        </FlowCanvasNode>

        {ruleItems.map((item, index) => (
          <FlowCanvasNode
            key={item.key}
            x={ruleX}
            y={ruleLayout[index].y}
            width={ruleWidth}
            onClick={item.onClick}
            onHoverChange={(active) =>
              setActiveCardKey(active ? ruleCardKey(item) : null)
            }
          >
            <div className="flex items-center justify-between gap-2">
              <Badge>RULE</Badge>
              <span className="text-xs text-muted-foreground">分流规则</span>
            </div>
            <p className="mt-2 truncate text-sm font-semibold">{item.label}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {item.subtitle}
            </p>
          </FlowCanvasNode>
        ))}

        {policyItems.map((item, index) => (
          <FlowCanvasNode
            key={String(item.target)}
            x={policyX}
            y={policyRowLayout[index].y}
            width={policyWidth}
            onClick={item.onClick}
            onHoverChange={(active) =>
              setActiveCardKey(
                active ? policyCardKey(String(item.target)) : null
              )
            }
          >
            <div className="flex items-center justify-between gap-2">
              <Badge>POLICY</Badge>
              <span className="text-xs text-muted-foreground">策略组</span>
            </div>
            <p className="mt-2 truncate text-sm font-semibold">{item.label}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {item.subtitle}
            </p>
          </FlowCanvasNode>
        ))}

        {outputItems.map((item, index) => (
          <FlowCanvasNode
            key={item.key}
            x={outputX}
            y={outputLayout[index].y}
            width={outputWidth}
            onHoverChange={(active) =>
              setActiveCardKey(active ? outputCardKey(item.key) : null)
            }
          >
            <div className="flex items-center justify-between gap-2">
              <Badge>OUTPUT</Badge>
              <span className="text-xs text-muted-foreground">出口节点</span>
            </div>
            <p className="mt-2 truncate text-sm font-semibold">{item.label}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.subtitle}
            </p>
          </FlowCanvasNode>
        ))}
      </div>
    </div>
  )
}

export default function AdminSubscriptionRulesPage() {
  const { confirm } = useConfirm()
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<SubscriptionRuleConfig>(DEFAULT_CONFIG)
  const [draft, setDraft] = useState<SubscriptionRuleConfig>(DEFAULT_CONFIG)
  const [availableNodes, setAvailableNodes] = useState<AvailableNode[]>([])
  const [saving, setSaving] = useState(false)
  const [editingPolicyGroup, setEditingPolicyGroup] =
    useState<EditingPolicyGroup>(null)
  const [editingBuiltinPolicy, setEditingBuiltinPolicy] =
    useState<EditingBuiltinPolicy>(null)
  const [editingBuiltinRule, setEditingBuiltinRule] =
    useState<EditingBuiltinRule>(null)
  const [editingFallbackRule, setEditingFallbackRule] =
    useState<EditingFallbackRule>(null)
  const [editingRule, setEditingRule] = useState<EditingRule>(null)
  const [editingRuleSet, setEditingRuleSet] = useState<EditingRuleSet>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFormat, setPreviewFormat] = useState<"clash" | "singbox">(
    "clash"
  )
  const [previewContent, setPreviewContent] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)

  const dirty = useMemo(
    () => JSON.stringify(saved) !== JSON.stringify(draft),
    [saved, draft]
  )

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const [rulesResponse, nodesResponse] = await Promise.all([
          fetch("/api/admin/subscription-rules"),
          fetch("/api/admin/nodes"),
        ])
        const rulesJson = await rulesResponse.json()
        const nodesJson = await nodesResponse.json()
        if (!mounted) return
        if (rulesJson?.ok) {
          const next = { ...DEFAULT_CONFIG, ...rulesJson.data, enabled: true }
          setSaved(next)
          setDraft(cloneConfig(next))
        }
        if (nodesJson?.ok && Array.isArray(nodesJson.data)) {
          setAvailableNodes(
            nodesJson.data.map((node: Record<string, unknown>) => ({
              id: Number(node.id),
              name: String(node.name ?? ""),
              status: node.status === "disabled" ? "disabled" : "enabled",
            }))
          )
        }
      } finally {
        if (mounted) setLoaded(true)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  function updatePolicyGroup(index: number, next: SubscriptionPolicyGroup) {
    setDraft((prev) => ({
      ...prev,
      policyGroups: prev.policyGroups.map((group, i) =>
        i === index ? next : group
      ),
    }))
  }

  function updateRule(index: number, next: SubscriptionRule) {
    setDraft((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, i) => (i === index ? next : rule)),
    }))
  }

  function updateRuleSet(index: number, next: SubscriptionRemoteRuleSet) {
    setDraft((prev) => ({
      ...prev,
      remoteRuleSets: prev.remoteRuleSets.map((ruleSet, i) =>
        i === index ? next : ruleSet
      ),
    }))
  }

  async function save() {
    setSaving(true)
    try {
      const response = await fetch("/api/admin/subscription-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, enabled: true }),
      })
      const json = await response.json()
      if (!response.ok || !json?.ok) {
        toast.error("保存失败", {
          description: json?.error?.message ?? "请检查规则配置",
        })
        return
      }
      const next = { ...DEFAULT_CONFIG, ...json.data, enabled: true }
      setSaved(next)
      setDraft(cloneConfig(next))
      toast.success("已保存", { description: "订阅分流规则已更新" })
    } catch {
      toast.error("保存失败", { description: "网络错误，请稍后重试" })
    } finally {
      setSaving(false)
    }
  }

  async function loadPreview(format: "clash" | "singbox") {
    setPreviewFormat(format)
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewContent("")
    try {
      const response = await fetch("/api/admin/subscription-rules/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, config: { ...draft, enabled: true } }),
      })
      const json = await response.json()
      if (!response.ok || !json?.ok) {
        toast.error("预览失败", {
          description: json?.error?.message ?? "请检查规则配置",
        })
        setPreviewOpen(false)
        return
      }
      setPreviewContent(json.data.content)
    } catch {
      toast.error("预览失败", { description: "网络错误，请稍后重试" })
      setPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  function startAddPolicyGroup() {
    setEditingPolicyGroup({ index: null, draft: newPolicyGroupDraft() })
  }

  function startEditBuiltinPolicy(target: SubscriptionRuleTarget) {
    setEditingBuiltinPolicy({
      target,
      draft: newBuiltinPolicyDraft(
        target,
        draft.builtinPolicyOverrides[
          target as keyof typeof draft.builtinPolicyOverrides
        ]
      ),
    })
  }

  function startEditPolicyGroup(index: number) {
    setEditingPolicyGroup({
      index,
      draft: structuredClone(draft.policyGroups[index]),
    })
  }

  function startAddRule() {
    setEditingRule({ index: null, draft: newRuleDraft() })
  }

  function startEditRule(index: number) {
    setEditingRule({
      index,
      draft: structuredClone(draft.rules[index]),
    })
  }

  function startAddRuleSet() {
    setEditingRuleSet({ index: null, draft: newRuleSetDraft() })
  }

  function startEditRuleSet(index: number) {
    setEditingRuleSet({
      index,
      draft: structuredClone(draft.remoteRuleSets[index]),
    })
  }

  function submitBuiltinPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingBuiltinPolicy) return
    setDraft((prev) => ({
      ...prev,
      builtinPolicyOverrides: {
        ...prev.builtinPolicyOverrides,
        [editingBuiltinPolicy.target]: normalizePolicyGroupPaths({
          ...editingBuiltinPolicy.draft,
          id: String(editingBuiltinPolicy.target),
        }),
      },
    }))
    setEditingBuiltinPolicy(null)
  }

  async function deleteEditingBuiltinPolicy() {
    if (!editingBuiltinPolicy) return
    const target = editingBuiltinPolicy.target
    const ok = await confirm({
      title: "删除内置策略",
      description:
        "确定要删除这个内置策略吗？引用它的规则和远程规则会自动改为节点选择，可之后恢复默认。",
      confirmText: "删除",
    })
    if (!ok) return

    setDraft((prev) => {
      const replacementTarget: SubscriptionRuleTarget =
        target === "proxy" ? "fallback" : "proxy"
      const builtinRuleOverrides = { ...prev.builtinRuleOverrides }
      for (const id of BUILTIN_SUBSCRIPTION_RULE_IDS) {
        const override = builtinRuleOverrides[id]
        const ruleTarget = override?.target ?? DEFAULT_BUILTIN_RULE_TARGETS[id]
        if (ruleTarget === target) {
          builtinRuleOverrides[id] = {
            enabled: override?.enabled !== false,
            target: replacementTarget,
          }
        }
      }

      return {
        ...prev,
        finalTarget:
          prev.finalTarget === target ? replacementTarget : prev.finalTarget,
        builtinPolicyOverrides: {
          ...prev.builtinPolicyOverrides,
          [target]: {
            ...newBuiltinPolicyDraft(target),
            enabled: false,
          },
        },
        builtinRuleOverrides,
        rules: prev.rules.map((rule) =>
          rule.target === target ? { ...rule, target: replacementTarget } : rule
        ),
        remoteRuleSets: prev.remoteRuleSets.map((ruleSet) =>
          ruleSet.target === target
            ? { ...ruleSet, target: replacementTarget }
            : ruleSet
        ),
      }
    })
    setEditingBuiltinPolicy(null)
  }

  function submitBuiltinRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingBuiltinRule) return
    setDraft((prev) => ({
      ...prev,
      builtinRuleOverrides: {
        ...prev.builtinRuleOverrides,
        [editingBuiltinRule.id]: {
          enabled: editingBuiltinRule.enabled,
          target: editingBuiltinRule.target,
        },
      },
    }))
    setEditingBuiltinRule(null)
  }

  function submitFallbackRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingFallbackRule) return
    setDraft((prev) => ({ ...prev, finalTarget: editingFallbackRule.target }))
    setEditingFallbackRule(null)
  }

  async function deleteEditingBuiltinRule() {
    if (!editingBuiltinRule) return
    const ok = await confirm({
      title: "删除内置规则",
      description:
        "确定要删除这条内置分流规则吗？可之后在站点设置中重置策略恢复。",
      confirmText: "删除",
    })
    if (!ok) return
    setDraft((prev) => ({
      ...prev,
      builtinRuleOverrides: {
        ...prev.builtinRuleOverrides,
        [editingBuiltinRule.id]: {
          enabled: false,
          target: editingBuiltinRule.target,
        },
      },
    }))
    setEditingBuiltinRule(null)
  }

  function submitPolicyGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingPolicyGroup) return
    if (editingPolicyGroup.index === null) {
      setDraft((prev) => ({
        ...prev,
        policyGroups: [
          ...prev.policyGroups,
          normalizePolicyGroupPaths(editingPolicyGroup.draft),
        ],
      }))
    } else {
      updatePolicyGroup(
        editingPolicyGroup.index,
        normalizePolicyGroupPaths(editingPolicyGroup.draft)
      )
    }
    setEditingPolicyGroup(null)
  }

  async function deleteEditingPolicyGroup() {
    if (!editingPolicyGroup || editingPolicyGroup.index === null) return
    const groupId = draft.policyGroups[editingPolicyGroup.index]?.id
    if (!groupId) return

    const ok = await confirm({
      title: "删除策略组",
      description:
        "确定要删除这个策略组吗？引用它的规则和远程规则会自动改为节点选择。",
      confirmText: "删除",
    })
    if (!ok) return

    setDraft((prev) => ({
      ...prev,
      finalTarget: prev.finalTarget === groupId ? "fallback" : prev.finalTarget,
      policyGroups: prev.policyGroups.filter(
        (_, index) => index !== editingPolicyGroup.index
      ),
      rules: prev.rules.map((rule) =>
        rule.target === groupId ? { ...rule, target: "proxy" } : rule
      ),
      remoteRuleSets: prev.remoteRuleSets.map((ruleSet) =>
        ruleSet.target === groupId ? { ...ruleSet, target: "proxy" } : ruleSet
      ),
    }))
    setEditingPolicyGroup(null)
  }

  function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRule) return
    if (editingRule.index === null) {
      setDraft((prev) => ({
        ...prev,
        rules: [...prev.rules, editingRule.draft],
      }))
    } else {
      updateRule(editingRule.index, editingRule.draft)
    }
    setEditingRule(null)
  }

  async function deleteEditingRule() {
    if (!editingRule || editingRule.index === null) return
    const ok = await confirm({
      title: "删除规则",
      description: "确定要删除这条分流规则吗？",
      confirmText: "删除",
    })
    if (!ok) return

    setDraft((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, index) => index !== editingRule.index),
    }))
    setEditingRule(null)
  }

  function submitRuleSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingRuleSet) return
    if (editingRuleSet.index === null) {
      setDraft((prev) => ({
        ...prev,
        remoteRuleSets: [...prev.remoteRuleSets, editingRuleSet.draft],
      }))
    } else {
      updateRuleSet(editingRuleSet.index, editingRuleSet.draft)
    }
    setEditingRuleSet(null)
  }

  async function deleteEditingRuleSet() {
    if (!editingRuleSet || editingRuleSet.index === null) return
    const ok = await confirm({
      title: "删除远程规则",
      description: "确定要删除这条远程规则吗？",
      confirmText: "删除",
    })
    if (!ok) return

    setDraft((prev) => ({
      ...prev,
      remoteRuleSets: prev.remoteRuleSets.filter(
        (_, index) => index !== editingRuleSet.index
      ),
    }))
    setEditingRuleSet(null)
  }

  if (!loaded) {
    return (
      <div className="relative h-[calc(100svh-3rem)] overflow-hidden bg-background">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    )
  }

  return (
    <div className="w-full">
      <FlowView
        config={draft}
        availableNodes={availableNodes}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onPreviewClash={() => void loadPreview("clash")}
        onPreviewSingbox={() => void loadPreview("singbox")}
        onAddRule={startAddRule}
        onEditRule={startEditRule}
        onAddRuleSet={startAddRuleSet}
        onEditRuleSet={startEditRuleSet}
        onAddPolicyGroup={startAddPolicyGroup}
        onEditPolicyGroup={startEditPolicyGroup}
        onEditBuiltinPolicy={startEditBuiltinPolicy}
        onEditBuiltinRule={setEditingBuiltinRule}
        onEditFallbackRule={(target) => setEditingFallbackRule({ target })}
      />

      <Sheet
        open={editingBuiltinPolicy !== null}
        onOpenChange={(open) => !open && setEditingBuiltinPolicy(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>编辑内置策略</SheetTitle>
            <SheetDescription>
              内置策略的 ID 会被 Clash / sing-box
              规则引用，不能修改；可调整显示名称、节点范围和出口。
            </SheetDescription>
          </SheetHeader>
          {editingBuiltinPolicy ? (
            <div className="flex flex-col gap-3 px-4 pb-4">
              {draft.builtinPolicyOverrides[
                editingBuiltinPolicy.target as keyof typeof draft.builtinPolicyOverrides
              ] ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDraft((prev) => {
                      const nextOverrides = { ...prev.builtinPolicyOverrides }
                      delete nextOverrides[
                        editingBuiltinPolicy.target as keyof typeof nextOverrides
                      ]
                      return { ...prev, builtinPolicyOverrides: nextOverrides }
                    })
                    setEditingBuiltinPolicy(null)
                  }}
                >
                  恢复此内置策略默认值
                </Button>
              ) : null}
              <PolicyGroupForm
                draft={editingBuiltinPolicy.draft}
                availableNodes={availableNodes}
                idReadonly
                setDraft={(next) =>
                  setEditingBuiltinPolicy({
                    ...editingBuiltinPolicy,
                    draft: next,
                  })
                }
                onSubmit={submitBuiltinPolicy}
                onDelete={() => void deleteEditingBuiltinPolicy()}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingBuiltinRule !== null}
        onOpenChange={(open) => !open && setEditingBuiltinRule(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingBuiltinRule
                ? `编辑内置规则：${BUILTIN_SUBSCRIPTION_RULE_LABELS[editingBuiltinRule.id].name}`
                : "编辑内置规则"}
            </SheetTitle>
            <SheetDescription>
              内置规则只支持调整命中后的目标策略；规则内容来自默认订阅模板。
            </SheetDescription>
          </SheetHeader>
          {editingBuiltinRule ? (
            <form
              className="flex flex-col gap-4 px-4 pb-4"
              onSubmit={submitBuiltinRule}
            >
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {BUILTIN_SUBSCRIPTION_RULE_LABELS[editingBuiltinRule.id].name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {
                    BUILTIN_SUBSCRIPTION_RULE_LABELS[editingBuiltinRule.id]
                      .description
                  }
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label>匹配内容预览</Label>
                <div className="max-h-56 overflow-y-auto rounded-lg border bg-muted/20 p-3 font-mono text-xs">
                  {BUILTIN_SUBSCRIPTION_RULE_PREVIEW_LINES[
                    editingBuiltinRule.id
                  ].map((line) => (
                    <p key={line} className="truncate">
                      {line}
                    </p>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  内置规则的匹配内容由默认模板维护；如需完全自定义匹配内容，可删除此内置规则后新增普通规则或远程规则。
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label>目标策略</Label>
                <RuleTargetSelect
                  value={editingBuiltinRule.target}
                  policyGroups={draft.policyGroups}
                  onChange={(target) =>
                    setEditingBuiltinRule({ ...editingBuiltinRule, target })
                  }
                />
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <Switch
                  checked={editingBuiltinRule.enabled}
                  onCheckedChange={(enabled) =>
                    setEditingBuiltinRule({ ...editingBuiltinRule, enabled })
                  }
                />
                <span className="text-sm">启用此内置规则</span>
              </label>
              <SheetFooter className="flex-row justify-between px-0">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void deleteEditingBuiltinRule()}
                >
                  删除规则
                </Button>
                <Button type="submit">保存规则</Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingFallbackRule !== null}
        onOpenChange={(open) => !open && setEditingFallbackRule(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>编辑未匹配流量</SheetTitle>
            <SheetDescription>
              所有没有命中任何规则的流量，会进入这里配置的最终兜底策略。
            </SheetDescription>
          </SheetHeader>
          {editingFallbackRule ? (
            <form
              className="flex flex-col gap-4 px-4 pb-4"
              onSubmit={submitFallbackRule}
            >
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">未匹配流量</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  这是订阅分流的最后一条 MATCH / final 规则。
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label>最终兜底策略</Label>
                <RuleTargetSelect
                  value={editingFallbackRule.target}
                  policyGroups={draft.policyGroups}
                  onChange={(target) =>
                    setEditingFallbackRule({ ...editingFallbackRule, target })
                  }
                />
              </div>
              <SheetFooter className="px-0">
                <Button type="submit">保存兜底规则</Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingPolicyGroup !== null}
        onOpenChange={(open) => !open && setEditingPolicyGroup(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingPolicyGroup?.index === null ? "添加策略组" : "编辑策略组"}
            </SheetTitle>
            <SheetDescription>
              策略组会输出为 Clash proxy-group 和 sing-box selector / urltest。
            </SheetDescription>
          </SheetHeader>
          {editingPolicyGroup ? (
            <div className="px-4 pb-4">
              <PolicyGroupForm
                draft={editingPolicyGroup.draft}
                availableNodes={availableNodes}
                setDraft={(next) =>
                  setEditingPolicyGroup({ ...editingPolicyGroup, draft: next })
                }
                onSubmit={submitPolicyGroup}
                onDelete={
                  editingPolicyGroup.index === null
                    ? undefined
                    : () => void deleteEditingPolicyGroup()
                }
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingRule !== null}
        onOpenChange={(open) => !open && setEditingRule(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingRule?.index === null ? "添加规则" : "编辑规则"}
            </SheetTitle>
            <SheetDescription>
              规则会转换为 Clash 和 sing-box 各自支持的订阅分流语法。
            </SheetDescription>
          </SheetHeader>
          {editingRule ? (
            <div className="px-4 pb-4">
              <RuleForm
                draft={editingRule.draft}
                policyGroups={draft.policyGroups}
                setDraft={(next) =>
                  setEditingRule({ ...editingRule, draft: next })
                }
                onSubmit={submitRule}
                onDelete={
                  editingRule.index === null
                    ? undefined
                    : () => void deleteEditingRule()
                }
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editingRuleSet !== null}
        onOpenChange={(open) => !open && setEditingRuleSet(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              {editingRuleSet?.index === null ? "添加远程规则" : "编辑远程规则"}
            </SheetTitle>
            <SheetDescription>
              Clash 使用 rule-provider，sing-box 使用 rule_set；两者 URL
              可独立配置。
            </SheetDescription>
          </SheetHeader>
          {editingRuleSet ? (
            <div className="px-4 pb-4">
              <RuleSetForm
                draft={editingRuleSet.draft}
                policyGroups={draft.policyGroups}
                setDraft={(next) =>
                  setEditingRuleSet({ ...editingRuleSet, draft: next })
                }
                onSubmit={submitRuleSet}
                onDelete={
                  editingRuleSet.index === null
                    ? undefined
                    : () => void deleteEditingRuleSet()
                }
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>
              {previewFormat === "clash" ? "Clash 预览" : "sing-box 预览"}
            </SheetTitle>
            <SheetDescription>
              使用当前已启用节点生成，仅用于确认订阅模板和分流规则结构。
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="flex gap-2">
              <Button
                variant={previewFormat === "clash" ? "default" : "outline"}
                size="sm"
                onClick={() => void loadPreview("clash")}
              >
                Clash
              </Button>
              <Button
                variant={previewFormat === "singbox" ? "default" : "outline"}
                size="sm"
                onClick={() => void loadPreview("singbox")}
              >
                sing-box
              </Button>
            </div>
            {previewLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <Textarea
                readOnly
                className="min-h-96 font-mono text-xs"
                value={previewContent}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
