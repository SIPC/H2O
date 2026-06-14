"use client"

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Variant = "default" | "destructive"

type ConfirmOptions = {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  variant?: Variant
  contentClassName?: string
}

type AlertOptions = {
  title: string
  description?: ReactNode
  confirmText?: string
  variant?: Variant
  contentClassName?: string
}

type ConfirmContextValue = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  alert: (opts: AlertOptions) => Promise<void>
}

// 供业务页面替换 window.confirm / window.alert
const ConfirmContext = createContext<ConfirmContextValue | null>(null)

type DialogState =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void }
  | null

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [state, setState] = useState<DialogState>(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ kind: "confirm", opts, resolve })
      }),
    []
  )

  const alert = useCallback(
    (opts: AlertOptions) =>
      new Promise<void>((resolve) => {
        setState({ kind: "alert", opts, resolve })
      }),
    []
  )

  const close = useCallback(
    (confirmed: boolean) => {
      if (!state) return
      if (state.kind === "confirm") state.resolve(confirmed)
      else state.resolve()
      setState(null)
    },
    [state]
  )

  const opts = state?.opts
  const isConfirm = state?.kind === "confirm"
  const variant: Variant = opts?.variant ?? "default"

  return (
    <ConfirmContext.Provider value={{ confirm, alert }}>
      {children}
      <Dialog
        open={state !== null}
        onOpenChange={(next) => {
          if (!next) close(false)
        }}
      >
        <DialogContent className={opts?.contentClassName}>
          <DialogHeader>
            <DialogTitle>{opts?.title ?? ""}</DialogTitle>
            {opts?.description ? (
              <DialogDescription asChild>
                <div className="min-w-0 overflow-hidden">
                  {opts.description}
                </div>
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            {isConfirm ? (
              <Button variant="outline" onClick={() => close(false)}>
                {(opts as ConfirmOptions | undefined)?.cancelText ??
                  t("common.cancel")}
              </Button>
            ) : null}
            <Button
              variant={variant === "destructive" ? "destructive" : "default"}
              onClick={() => close(true)}
            >
              {opts?.confirmText ??
                (isConfirm ? t("common.confirm") : t("common.ok"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider")
  return ctx
}
