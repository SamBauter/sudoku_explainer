import { useMemo, useRef, useState, type ReactNode } from "react"
import { Loader2, Play, RefreshCw, Square } from "lucide-react"
import { toast } from "sonner"

import { SearchBox } from "@/components/SearchBox"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { listAssignments, streamDateUpdates } from "@/lib/canvas"
import { buildDateUpdateItem, projectField } from "@/lib/dates"
import type {
  Assignment,
  CanvasSession,
  DateField,
  DateOp,
} from "@/types"
import { DATE_FIELDS } from "@/types"

import {
  DatesPreviewTable,
  type DatesPreviewRow,
} from "./DatesPreviewTable"

interface DatesPanelProps {
  session: CanvasSession
}

const FIELD_LABELS: Record<DateField, string> = {
  due_at: "Due date",
  unlock_at: "Available from",
  lock_at: "Until",
}

function parseIntOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function defaultOps(): Record<DateField, DateOp> {
  return {
    due_at: { kind: "keep" },
    unlock_at: { kind: "keep" },
    lock_at: { kind: "keep" },
  }
}

export function DatesPanel({ session }: DatesPanelProps) {
  const [courseId, setCourseId] = useState("")
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [ops, setOps] = useState<Record<DateField, DateOp>>(defaultOps)

  // Row-local selection + per-row commit/error markers.
  const [rowState, setRowState] = useState<
    Map<
      number,
      {
        selected?: boolean
        committed?: Partial<Record<DateField, string | null>>
        error?: string
      }
    >
  >(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const [filter, setFilter] = useState<"all" | "changed" | "unchanged">("all")
  const [search, setSearch] = useState("")

  const cid = parseIntOrNull(courseId)

  const rows: DatesPreviewRow[] = useMemo(() => {
    return assignments.map((a) => {
      const current: Record<DateField, string | null> = {
        due_at: a.due_at ?? null,
        unlock_at: a.unlock_at ?? null,
        lock_at: a.lock_at ?? null,
      }
      const projected: Partial<Record<DateField, string | null>> = {}
      for (const field of DATE_FIELDS) {
        const p = projectField(current[field], ops[field])
        if (p.changes) projected[field] = p.value
      }
      const state = rowState.get(a.id)
      return {
        id: a.id,
        name: a.name,
        current,
        projected,
        // Don't auto-select on op changes; let the teacher drive selection
        // with the search box + checkboxes. Defaults to unselected on load.
        selected: state?.selected ?? false,
        committed: state?.committed,
        error: state?.error,
      }
    })
  }, [assignments, ops, rowState])

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, search])

  const changedCount = searchMatches.reduce(
    (n, r) => (Object.keys(r.projected).length > 0 ? n + 1 : n),
    0,
  )
  const unchangedCount = searchMatches.length - changedCount

  const visibleRows: DatesPreviewRow[] = useMemo(() => {
    if (filter === "all") return searchMatches
    if (filter === "changed") {
      return searchMatches.filter((r) => Object.keys(r.projected).length > 0)
    }
    return searchMatches.filter((r) => Object.keys(r.projected).length === 0)
  }, [searchMatches, filter])

  const selectedRows = rows.filter((r) => r.selected)
  const eligible = selectedRows.filter(
    (r) => Object.keys(r.projected).length > 0,
  )
  const noopSelected = selectedRows.length - eligible.length

  async function handleLoad() {
    if (!cid) return
    setLoading(true)
    setRowState(new Map())
    try {
      const list = await listAssignments(session, cid)
      setAssignments(list)
      if (list.length === 0) toast.message("No assignments found for that course.")
      else toast.success(`Loaded ${list.length} assignments.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }

  function patchRow(id: number, patch: { selected?: boolean }) {
    setRowState((prev) => {
      const next = new Map(prev)
      const existing = next.get(id) ?? {}
      next.set(id, { ...existing, ...patch })
      return next
    })
  }

  function toggleAll(selected: boolean) {
    setRowState((prev) => {
      const next = new Map(prev)
      // Toggle every currently visible row, regardless of whether the
      // current op would change it. The apply step still skips rows
      // whose op produces no change, so a trailing no-op selection is
      // harmless.
      for (const row of visibleRows) {
        const existing = next.get(row.id) ?? {}
        next.set(row.id, { ...existing, selected })
      }
      return next
    })
  }

  async function handleApply() {
    if (!cid) return
    if (eligible.length === 0) {
      toast.message("Nothing to update.")
      return
    }

    const ok = window.confirm(
      `Update dates on ${eligible.length} ${eligible.length === 1 ? "assignment" : "assignments"} in course ${cid}? ` +
        "Students will see the new schedule immediately.",
    )
    if (!ok) return

    setBusy(true)
    const payload = eligible.map((r) =>
      buildDateUpdateItem(r.id, r.current, ops),
    )

    // Clear stale commit/error markers on rows we're about to re-run.
    setRowState((prev) => {
      const next = new Map(prev)
      for (const { id } of eligible) {
        const existing = next.get(id) ?? {}
        next.set(id, {
          ...existing,
          committed: undefined,
          error: undefined,
        })
      }
      return next
    })

    try {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      for await (const ev of streamDateUpdates(session, cid, payload, {
        signal: ctrl.signal,
      })) {
        if (ev.kind === "updated") {
          const id = ev.assignment_id
          const committed = ev.committed
          setRowState((prev) => {
            const next = new Map(prev)
            const existing = next.get(id) ?? {}
            next.set(id, { ...existing, committed, error: undefined })
            return next
          })
          // Mirror the commit onto the in-memory assignment so a
          // follow-up "Shift by +3 days" picks up the new current
          // values without needing to reload the course.
          setAssignments((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    due_at:
                      "due_at" in committed ? committed.due_at ?? null : a.due_at,
                    unlock_at:
                      "unlock_at" in committed
                        ? committed.unlock_at ?? null
                        : a.unlock_at,
                    lock_at:
                      "lock_at" in committed
                        ? committed.lock_at ?? null
                        : a.lock_at,
                  }
                : a,
            ),
          )
        } else if (ev.kind === "error" && ev.assignment_id != null) {
          const id = ev.assignment_id
          const error = ev.error
          setRowState((prev) => {
            const next = new Map(prev)
            const existing = next.get(id) ?? {}
            next.set(id, { ...existing, error })
            return next
          })
        } else if (ev.kind === "done") {
          toast.success(
            `Updated ${ev.updated} of ${eligible.length} assignment(s).`,
          )
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.toLowerCase().includes("abort")) toast.error(message)
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
  }

  return (
    <Card className="glass-strong border-0">
      <CardHeader>
        <CardTitle className="text-lg">Update assignment dates</CardTitle>
        <CardDescription>
          Bulk-edit <em>Due</em>, <em>Available from</em>, and <em>Until</em>{" "}
          dates on multiple assignments at once. Each field can be left
          alone, set to an absolute date, shifted by N days, or cleared.
          Times are shown and entered in your local timezone and sent to
          Canvas as UTC.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="dates-course-id">Course ID</Label>
            <Input
              id="dates-course-id"
              inputMode="numeric"
              placeholder="e.g. 123456"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              disabled={loading || busy}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleLoad}
              disabled={!cid || loading || busy}
              variant="secondary"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {loading ? "Loading\u2026" : "Load assignments"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {DATE_FIELDS.map((field) => (
            <FieldOpControl
              key={field}
              label={FIELD_LABELS[field]}
              op={ops[field]}
              onChange={(next) => setOps((prev) => ({ ...prev, [field]: next }))}
              disabled={busy}
            />
          ))}
        </div>

        {rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="glass-subtle inline-flex rounded-lg p-1 text-sm">
              <FilterButton
                active={filter === "all"}
                onClick={() => setFilter("all")}
                count={searchMatches.length}
              >
                All
              </FilterButton>
              <FilterButton
                active={filter === "changed"}
                onClick={() => setFilter("changed")}
                count={changedCount}
              >
                Would change
              </FilterButton>
              <FilterButton
                active={filter === "unchanged"}
                onClick={() => setFilter("unchanged")}
                count={unchangedCount}
              >
                Unchanged
              </FilterButton>
            </div>

            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search original name, e.g. &ldquo;Arguments and Parameters&rdquo;"
            />
          </div>
        ) : null}

        {rows.length > 0 && visibleRows.length === 0 ? (
          <div className="glass-subtle text-muted-foreground rounded-lg p-4 text-center text-sm">
            No assignments match the current filter
            {search ? ` / search for "${search}"` : ""}.
          </div>
        ) : (
          <DatesPreviewTable
            rows={visibleRows}
            onChange={patchRow}
            onToggleAll={toggleAll}
            disabled={busy}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleApply}
            disabled={busy || eligible.length === 0}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {busy
              ? "Updating\u2026"
              : eligible.length
                ? selectedRows.length > eligible.length
                  ? `Update ${eligible.length} of ${selectedRows.length} selected`
                  : `Update ${eligible.length} selected`
                : selectedRows.length > 0
                  ? "Selected rows won\u2019t change under the current op"
                  : "Nothing selected"}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={handleCancel}>
              <Square className="size-4" />
              Stop
            </Button>
          ) : null}
          {noopSelected > 0 && eligible.length > 0 ? (
            <span className="text-muted-foreground text-xs">
              {noopSelected} selected row{noopSelected === 1 ? "" : "s"} produce
              no change under the current op and will be skipped.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function FieldOpControl({
  label,
  op,
  onChange,
  disabled,
}: {
  label: string
  op: DateOp
  onChange: (next: DateOp) => void
  disabled?: boolean
}) {
  return (
    <div className="glass-subtle space-y-2 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
      </div>

      <div className="inline-flex w-full rounded-md bg-background/60 p-0.5 text-xs">
        <OpToggle
          active={op.kind === "keep"}
          onClick={() => onChange({ kind: "keep" })}
          disabled={disabled}
        >
          Keep
        </OpToggle>
        <OpToggle
          active={op.kind === "set"}
          onClick={() =>
            onChange({ kind: "set", setLocal: op.setLocal ?? "" })
          }
          disabled={disabled}
        >
          Set
        </OpToggle>
        <OpToggle
          active={op.kind === "shift_days"}
          onClick={() =>
            onChange({ kind: "shift_days", shiftDays: op.shiftDays ?? 0 })
          }
          disabled={disabled}
        >
          Shift
        </OpToggle>
        <OpToggle
          active={op.kind === "clear"}
          onClick={() => onChange({ kind: "clear" })}
          disabled={disabled}
        >
          Clear
        </OpToggle>
      </div>

      {op.kind === "set" ? (
        <Input
          type="datetime-local"
          value={op.setLocal ?? ""}
          onChange={(e) =>
            onChange({ kind: "set", setLocal: e.target.value })
          }
          disabled={disabled}
          className="text-sm"
          aria-label={`${label} target date (local time)`}
        />
      ) : null}

      {op.kind === "shift_days" ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            value={String(op.shiftDays ?? 0)}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange({
                kind: "shift_days",
                shiftDays: Number.isFinite(n) ? n : 0,
              })
            }}
            disabled={disabled}
            className="w-24 text-sm"
            aria-label={`${label} shift in days`}
          />
          <span className="text-muted-foreground text-xs">days</span>
        </div>
      ) : null}

      {op.kind === "clear" ? (
        <p className="text-muted-foreground text-xs">
          Field will be set to null on Canvas for every selected assignment.
        </p>
      ) : null}

      {op.kind === "keep" ? (
        <p className="text-muted-foreground text-xs">
          No change to this field.
        </p>
      ) : null}
    </div>
  )
}

function OpToggle({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        active
          ? "bg-primary text-primary-foreground flex-1 rounded-sm px-2 py-1 font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground flex-1 rounded-sm px-2 py-1 font-medium disabled:opacity-50"
      }
    >
      {children}
    </button>
  )
}

function FilterButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium shadow-xs"
          : "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium"
      }
    >
      {children}
      <span
        className={
          active
            ? "bg-primary-foreground/20 text-primary-foreground rounded-full px-1.5 text-xs tabular-nums"
            : "bg-foreground/10 text-muted-foreground rounded-full px-1.5 text-xs tabular-nums"
        }
      >
        {count}
      </span>
    </button>
  )
}
