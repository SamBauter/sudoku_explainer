import type { DateField, DateOp, FieldUpdate } from "@/types"

/**
 * Format an ISO UTC timestamp for display in the viewer's local
 * timezone, or a dash when unset.
 */
export function formatLocal(iso: string | null | undefined): string {
  if (!iso) return "\u2014"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Format an ISO UTC timestamp into a `<input type="datetime-local">`-
 * compatible local string, `YYYY-MM-DDTHH:MM`. Returns an empty string
 * for null input (which is the neutral value for datetime-local).
 */
export function toDatetimeLocalInput(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * Parse a local `YYYY-MM-DDTHH:MM` string (what datetime-local yields)
 * into an ISO UTC timestamp. Returns null on an empty/malformed input
 * so callers can distinguish "no value" from a real date.
 */
export function fromDatetimeLocalInput(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Add `days` (may be negative) to an ISO timestamp. Null stays null. */
export function shiftIsoByDays(
  iso: string | null | undefined,
  days: number,
): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/**
 * Translate a per-field bulk operation into the `FieldUpdate` payload
 * for one specific assignment, given its current value on that field.
 *
 * Returns a `{ action: "keep" }` whenever the op either is "keep" or
 * can't meaningfully apply (e.g. shifting a null due date). Keeping
 * those rows is the conservative default; the preview shows when a
 * shift had no effect so the teacher can see it.
 */
export function computeFieldUpdate(
  current: string | null | undefined,
  op: DateOp,
): FieldUpdate {
  if (op.kind === "keep") return { action: "keep" }
  if (op.kind === "clear") return { action: "clear" }
  if (op.kind === "set") {
    const iso = fromDatetimeLocalInput(op.setLocal ?? "")
    if (!iso) return { action: "keep" }
    return { action: "set", value: iso }
  }
  // shift_days: only applies where there's a value to shift
  const days = op.shiftDays ?? 0
  if (!current || !Number.isFinite(days) || days === 0) return { action: "keep" }
  const next = shiftIsoByDays(current, days)
  return next ? { action: "set", value: next } : { action: "keep" }
}

/**
 * Compute the projected final value for a field after applying the op
 * to a row's current value, for preview rendering. Returns:
 *   - `{ changes: false }` if the row would keep its current state
 *   - `{ changes: true, value: string | null }` otherwise, where
 *     `value` is the projected new state (null for a cleared field).
 */
export function projectField(
  current: string | null | undefined,
  op: DateOp,
): { changes: false } | { changes: true; value: string | null } {
  const update = computeFieldUpdate(current, op)
  if (update.action === "keep") return { changes: false }
  if (update.action === "clear") {
    return current ? { changes: true, value: null } : { changes: false }
  }
  // "set"
  const next = update.value ?? null
  if (next === current) return { changes: false }
  return { changes: true, value: next }
}

/**
 * Build the per-assignment payload for the dates-update endpoint, one
 * row at a time, given the three field operations.
 */
export function buildDateUpdateItem(
  id: number,
  currents: Partial<Record<DateField, string | null>>,
  ops: Record<DateField, DateOp>,
): {
  id: number
  due_at: FieldUpdate
  unlock_at: FieldUpdate
  lock_at: FieldUpdate
} {
  return {
    id,
    due_at: computeFieldUpdate(currents.due_at, ops.due_at),
    unlock_at: computeFieldUpdate(currents.unlock_at, ops.unlock_at),
    lock_at: computeFieldUpdate(currents.lock_at, ops.lock_at),
  }
}
