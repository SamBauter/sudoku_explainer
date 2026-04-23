import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { formatLocal } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { DATE_FIELDS, type DateField } from "@/types"

export interface DatesPreviewRow {
  id: number
  name: string
  current: Record<DateField, string | null>
  /**
   * Per-field projected state. `undefined` means this op leaves the
   * field alone (or can't apply, e.g. shifting a null date). A string
   * is the new ISO value. `null` means the field would be cleared.
   */
  projected: Partial<Record<DateField, string | null>>
  selected: boolean
  /** Committed echo from the server after a successful run. */
  committed?: Partial<Record<DateField, string | null>>
  error?: string
}

interface DatesPreviewTableProps {
  rows: DatesPreviewRow[]
  onChange: (id: number, patch: { selected?: boolean }) => void
  onToggleAll: (selected: boolean) => void
  disabled?: boolean
}

const FIELD_LABELS: Record<DateField, string> = {
  due_at: "Due",
  unlock_at: "Available from",
  lock_at: "Until",
}

export function DatesPreviewTable({
  rows,
  onChange,
  onToggleAll,
  disabled,
}: DatesPreviewTableProps) {
  const changedCount = rows.filter((r) => rowChanges(r)).length
  const selectedCount = rows.filter((r) => r.selected).length
  const allSelected = rows.length > 0 && rows.every((r) => r.selected)

  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(v) => onToggleAll(v === true)}
            disabled={disabled || rows.length === 0}
            aria-label="Select all visible rows"
          />
          <span>
            {selectedCount} selected &middot; {changedCount} would change
            &middot; {rows.length} total
          </span>
        </div>
        <span>times shown in your local timezone</span>
      </div>

      <div className="glass-subtle max-h-[32rem] overflow-y-auto rounded-lg">
        <ul className="divide-border/60 divide-y">
          {rows.map((row) => (
            <DatesRowItem
              key={row.id}
              row={row}
              onChange={onChange}
              disabled={disabled}
            />
          ))}
          {rows.length === 0 ? (
            <li className="text-muted-foreground p-4 text-center text-sm">
              Load a course above to see its assignments here.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}

function rowChanges(row: DatesPreviewRow): boolean {
  return DATE_FIELDS.some((field) => field in row.projected)
}

function DatesRowItem({
  row,
  onChange,
  disabled,
}: {
  row: DatesPreviewRow
  onChange: (id: number, patch: { selected?: boolean }) => void
  disabled?: boolean
}) {
  const changed = rowChanges(row)
  const committed = row.committed !== undefined
  const errored = row.error !== undefined

  return (
    <li
      className={cn(
        "grid grid-cols-[auto_1fr] gap-3 p-3 text-sm",
        committed && "bg-emerald-50/40",
        errored && "bg-destructive/5",
      )}
    >
      <Checkbox
        checked={row.selected}
        onCheckedChange={(v) => onChange(row.id, { selected: v === true })}
        disabled={disabled}
        aria-label={`Select "${row.name}"`}
        className="mt-1.5"
      />

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-medium">{row.name}</span>
          {!changed ? (
            <Badge tone="muted">unchanged</Badge>
          ) : committed ? (
            <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>
              updated
            </Badge>
          ) : errored ? (
            <Badge tone="destructive" icon={<AlertTriangle className="size-3" />}>
              error
            </Badge>
          ) : null}
        </div>

        {errored && row.error ? (
          <div className="bg-destructive/10 text-destructive rounded-md px-2 py-1 text-xs break-words">
            {row.error}
          </div>
        ) : null}

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          {DATE_FIELDS.map((field) => (
            <FieldCell
              key={field}
              label={FIELD_LABELS[field]}
              current={row.current[field]}
              projected={row.projected[field]}
              committed={row.committed?.[field]}
            />
          ))}
        </div>
      </div>
    </li>
  )
}

function FieldCell({
  label,
  current,
  projected,
  committed,
}: {
  label: string
  current: string | null
  // `undefined` = no change; `string` = new value; `null` = cleared
  projected: string | null | undefined
  committed: string | null | undefined
}) {
  const hasChange = projected !== undefined
  const hasCommit = committed !== undefined
  const shown = hasCommit ? committed : projected

  return (
    <div className="glass-subtle rounded-md px-2 py-1.5">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      {hasChange ? (
        <div className="flex flex-wrap items-center gap-1 font-mono text-[11px]">
          <span className="text-muted-foreground line-through">
            {formatLocal(current)}
          </span>
          <ArrowRight className="size-3 shrink-0" aria-hidden />
          <span
            className={cn(
              "font-medium",
              shown === null ? "text-destructive" : "text-foreground",
              hasCommit && "text-emerald-700",
            )}
          >
            {shown === null ? "cleared" : formatLocal(shown ?? null)}
          </span>
        </div>
      ) : (
        <div className="text-muted-foreground font-mono text-[11px]">
          {formatLocal(current)}
        </div>
      )}
    </div>
  )
}

function Badge({
  tone,
  icon,
  children,
}: {
  tone: "destructive" | "success" | "muted"
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const cls =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : tone === "success"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-muted text-muted-foreground"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
