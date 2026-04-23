import { AlertTriangle, CheckCircle2, RotateCcw, Scissors } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { truncateEnd } from "@/lib/rename"
import { cn } from "@/lib/utils"

export interface PreviewRow {
  id: number
  original: string
  ruleOutput: string
  override: string | null
  selected: boolean
  committedName?: string
  error?: string
}

interface RenamePreviewTableProps {
  rows: PreviewRow[]
  maxLength: number
  onChange: (id: number, patch: Partial<PreviewRow>) => void
  onToggleAll: (selected: boolean) => void
  disabled?: boolean
}

function finalName(row: PreviewRow): string {
  return row.override ?? row.ruleOutput
}

export function RenamePreviewTable({
  rows,
  maxLength,
  onChange,
  onToggleAll,
  disabled,
}: RenamePreviewTableProps) {
  const changedCount = rows.filter((r) => finalName(r) !== r.original).length
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
        <span>limit {maxLength}</span>
      </div>

      <div className="glass-subtle max-h-[32rem] overflow-y-auto rounded-lg">
        <ul className="divide-border/60 divide-y">
          {rows.map((row) => (
            <PreviewRowItem
              key={row.id}
              row={row}
              maxLength={maxLength}
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

function PreviewRowItem({
  row,
  maxLength,
  onChange,
  disabled,
}: {
  row: PreviewRow
  maxLength: number
  onChange: (id: number, patch: Partial<PreviewRow>) => void
  disabled?: boolean
}) {
  const final = finalName(row)
  const changed = final !== row.original
  const length = final.length
  const overLimit = length > maxLength
  const empty = length === 0
  const committed = row.committedName !== undefined
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
        aria-label={`Select "${row.original}"`}
        className="mt-2"
      />

      <div className="min-w-0 space-y-1.5">
        <div className="text-muted-foreground truncate text-xs">
          {row.original}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={final}
            onChange={(e) =>
              onChange(row.id, {
                override:
                  e.target.value === row.ruleOutput ? null : e.target.value,
              })
            }
            disabled={disabled}
            spellCheck={false}
            className={cn(
              "font-mono text-sm",
              overLimit && "aria-invalid:ring-destructive/30 border-destructive/60",
              committed && "border-emerald-500/60",
            )}
            aria-invalid={overLimit || undefined}
          />
          {overLimit ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() =>
                onChange(row.id, {
                  override: truncateEnd(final, maxLength),
                  selected: true,
                })
              }
              disabled={disabled}
              title={`Truncate to ${maxLength} characters`}
              aria-label={`Truncate to ${maxLength} characters`}
              className="size-8 text-destructive hover:text-destructive"
            >
              <Scissors className="size-4" />
            </Button>
          ) : null}
          {row.override !== null ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onChange(row.id, { override: null })}
              disabled={disabled}
              title="Revert to rule output"
              aria-label="Revert to rule output"
              className="size-8"
            >
              <RotateCcw className="size-4" />
            </Button>
          ) : null}
        </div>

        <RowStatus
          length={length}
          maxLength={maxLength}
          overLimit={overLimit}
          empty={empty}
          changed={changed}
          committed={committed}
          errored={errored}
          error={row.error}
          edited={row.override !== null}
        />
      </div>
    </li>
  )
}

function RowStatus({
  length,
  maxLength,
  overLimit,
  empty,
  changed,
  committed,
  errored,
  error,
  edited,
}: {
  length: number
  maxLength: number
  overLimit: boolean
  empty: boolean
  changed: boolean
  committed: boolean
  errored: boolean
  error?: string
  edited: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span
        className={cn(
          "tabular-nums",
          overLimit
            ? "text-destructive font-medium"
            : length > maxLength * 0.9
              ? "text-amber-700"
              : "text-muted-foreground",
        )}
      >
        {length}/{maxLength}
      </span>

      {empty ? (
        <Badge tone="destructive">empty</Badge>
      ) : overLimit ? (
        <Badge tone="destructive" icon={<AlertTriangle className="size-3" />}>
          needs truncation
        </Badge>
      ) : null}

      {!changed ? (
        <Badge tone="muted">unchanged</Badge>
      ) : committed ? (
        <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>
          renamed
        </Badge>
      ) : edited ? (
        <Badge tone="info">edited</Badge>
      ) : null}

      {errored && error ? (
        <span className="text-destructive break-words">{error}</span>
      ) : null}
    </div>
  )
}

function Badge({
  tone,
  icon,
  children,
}: {
  tone: "destructive" | "success" | "muted" | "info"
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  const cls =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : tone === "success"
        ? "bg-emerald-100 text-emerald-800"
        : tone === "info"
          ? "bg-sky-100 text-sky-800"
          : "bg-muted text-muted-foreground"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
        cls,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
