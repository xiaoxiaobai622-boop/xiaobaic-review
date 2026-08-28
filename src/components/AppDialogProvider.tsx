"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, CircleHelp, Info, MessageSquareText } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type DialogKind = "alert" | "confirm" | "prompt"
type DialogTone = "info" | "success" | "error" | "destructive"

interface DialogBaseOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

interface PromptOptions extends DialogBaseOptions {
  defaultValue?: string
  inputLabel?: string
  placeholder?: string
  required?: boolean
  maxLength?: number
}

interface DialogRequest extends DialogBaseOptions, PromptOptions {
  id: number
  kind: DialogKind
  resolve: (value: boolean | string | null | undefined) => void
}

let requestId = 0
const requestQueue: DialogRequest[] = []
const listeners = new Set<() => void>()

function emitQueueChange() {
  listeners.forEach((listener) => listener())
}

function enqueue<T>(request: Omit<DialogRequest, "id" | "resolve">): Promise<T> {
  return new Promise<T>((resolve) => {
    requestQueue.push({
      ...request,
      id: ++requestId,
      resolve: resolve as DialogRequest["resolve"],
    })
    emitQueueChange()
  })
}

function normalizeMessage(messageOrOptions: string | DialogBaseOptions): DialogBaseOptions {
  return typeof messageOrOptions === "string" ? { message: messageOrOptions } : messageOrOptions
}

export function appAlert(messageOrOptions: string | DialogBaseOptions): Promise<void> {
  return enqueue<void>({ kind: "alert", ...normalizeMessage(messageOrOptions) })
}

export function appConfirm(messageOrOptions: string | DialogBaseOptions): Promise<boolean> {
  return enqueue<boolean>({ kind: "confirm", ...normalizeMessage(messageOrOptions) })
}

export function appPrompt(messageOrOptions: string | PromptOptions, defaultValue = ""): Promise<string | null> {
  const options = typeof messageOrOptions === "string"
    ? { message: messageOrOptions, defaultValue }
    : messageOrOptions
  return enqueue<string | null>({ kind: "prompt", ...options })
}

function inferTone(request: DialogRequest): DialogTone {
  if (request.tone) return request.tone
  const text = `${request.title || ""} ${request.message}`.toLowerCase()
  if (/删除|永久|移除|清除|退出|撤销|delete|remove|clear|leave|permanent|löschen|entfern|verwijder/.test(text)) {
    return "destructive"
  }
  if (/失败|错误|无法|error|failed|unable|fehl|mislukt/.test(text)) return "error"
  if (/成功|完成|success|completed|erfolgreich|geslaagd/.test(text)) return "success"
  return "info"
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common")
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [inputError, setInputError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const syncRequest = () => setRequest(requestQueue[0] || null)
    listeners.add(syncRequest)
    syncRequest()
    return () => {
      listeners.delete(syncRequest)
    }
  }, [])

  useEffect(() => {
    if (request?.kind !== "prompt") return
    setInputValue(request.defaultValue || "")
    setInputError("")
  }, [request])

  const finish = (value: boolean | string | null | undefined) => {
    if (!request) return
    const current = requestQueue[0]
    if (!current || current.id !== request.id) return
    requestQueue.shift()
    current.resolve(value)
    emitQueueChange()
  }

  const cancel = () => {
    if (request?.kind === "confirm") finish(false)
    else if (request?.kind === "prompt") finish(null)
    else finish(undefined)
  }

  const submitPrompt = (event: FormEvent) => {
    event.preventDefault()
    if (!request) return
    if (request.required && !inputValue.trim()) {
      setInputError(t("inputRequired"))
      inputRef.current?.focus()
      return
    }
    finish(inputValue)
  }

  const tone = request ? inferTone(request) : "info"
  const Icon = request?.kind === "prompt"
    ? MessageSquareText
    : tone === "success"
      ? CheckCircle2
      : tone === "error" || tone === "destructive"
        ? AlertCircle
        : request?.kind === "confirm"
          ? CircleHelp
          : Info

  const title = request?.title || (
    request?.kind === "prompt"
      ? t("inputTitle")
      : request?.kind === "confirm"
        ? t("confirmationTitle")
        : tone === "error"
          ? t("error")
          : t("noticeTitle")
  )

  return (
    <>
      {children}
      <Dialog open={Boolean(request)} onOpenChange={(open) => !open && cancel()}>
        <DialogContent
          hideClose
          className="w-[calc(100%-2rem)] max-w-[440px] gap-0 overflow-hidden rounded-2xl border-border/80 bg-card !p-0 shadow-[0_18px_45px_-18px_hsl(var(--foreground)/0.35)] sm:!p-0"
          onOpenAutoFocus={(event) => {
            if (request?.kind === "prompt") {
              event.preventDefault()
              window.setTimeout(() => inputRef.current?.focus(), 0)
            }
          }}
        >
          <form noValidate onSubmit={request?.kind === "prompt" ? submitPrompt : (event) => event.preventDefault()}>
            <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <div
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  tone === "success" && "bg-success-visible text-success",
                  tone === "error" && "bg-destructive-visible text-destructive",
                  tone === "destructive" && "bg-destructive-visible text-destructive",
                  tone === "info" && "bg-primary-visible text-primary"
                )}
                aria-hidden="true"
              >
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <DialogHeader className="min-w-0 flex-1 space-y-1.5 pr-1 text-left">
                <DialogTitle className="text-lg font-semibold leading-6">{title}</DialogTitle>
                <DialogDescription className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {request?.message}
                </DialogDescription>
              </DialogHeader>
            </div>

            {request?.kind === "prompt" && (
              <div className="px-5 pb-5 sm:px-6">
                {request.inputLabel && (
                  <Label htmlFor="app-dialog-input" className="mb-2 block text-sm font-medium">
                    {request.inputLabel}
                  </Label>
                )}
                <Input
                  ref={inputRef}
                  id="app-dialog-input"
                  value={inputValue}
                  onChange={(event) => {
                    setInputValue(event.target.value)
                    if (inputError) setInputError("")
                  }}
                  placeholder={request.placeholder}
                  aria-required={request.required}
                  maxLength={request.maxLength}
                  aria-invalid={Boolean(inputError)}
                  aria-describedby={inputError ? "app-dialog-input-error" : undefined}
                  className={cn("h-11 rounded-full bg-muted/45 px-4 text-base sm:text-sm", inputError && "border-destructive focus-visible:ring-destructive")}
                />
                {inputError && (
                  <p id="app-dialog-input-error" className="mt-2 text-sm text-destructive" role="alert">
                    {inputError}
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="!flex !flex-col !items-stretch !justify-start gap-2 border-t border-border/70 bg-muted/35 px-5 py-3 sm:!flex-col sm:!items-stretch sm:!justify-start sm:px-6">
              <Button
                type={request?.kind === "prompt" ? "submit" : "button"}
                variant={tone === "destructive" || tone === "error" ? "destructive" : "default"}
                onClick={request?.kind === "prompt" ? undefined : () => finish(request?.kind === "confirm" ? true : undefined)}
                className="order-1 h-10 w-full rounded-full"
              >
                {request?.confirmLabel || (request?.kind === "alert" ? t("close") : t("confirm"))}
              </Button>
              {request?.kind !== "alert" && (
                <Button type="button" variant="outline" onClick={cancel} className="order-2 h-10 w-full rounded-full bg-card">
                  {request?.cancelLabel || t("cancel")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
