export type PolicyKind = "missing" | "late"

export interface ClearStats {
  scanned: number
  skipped: number
  cleared: number
}

export type ProgressEvent =
  | { kind: "start"; total_assignments: number }
  | {
      kind: "assignment_done"
      index: number
      assignment_id: number
      assignment_name: string | null
      stats: ClearStats
    }
  | {
      kind: "assignment_error"
      index?: number
      assignment_id?: number
      assignment_name?: string | null
      error: string
    }
  | { kind: "done"; totals: ClearStats }

export interface CanvasSession {
  token: string
  baseUrl: string
}

// ---------------------------------------------------------------------------
// Assignment rename tool
// ---------------------------------------------------------------------------

export interface Assignment {
  id: number
  name: string
  position: number | null
  published: boolean | null
  /**
   * Canvas-returned ISO-8601 UTC timestamps. Null when unset. The UI
   * formats these in the viewer's local timezone.
   */
  due_at: string | null
  unlock_at: string | null
  lock_at: string | null
}

export interface RenameRule {
  /** Client-side id used as a React key and for reordering. */
  id: string
  enabled: boolean
  find: string
  replace: string
}

export type RenameEvent =
  | { kind: "start"; total: number }
  | {
      kind: "renamed"
      index: number
      assignment_id: number
      new_name: string
    }
  | {
      kind: "error"
      index?: number
      assignment_id?: number
      error: string
    }
  | { kind: "done"; renamed: number }

// ---------------------------------------------------------------------------
// Assignment dates tool
// ---------------------------------------------------------------------------

/**
 * The three Canvas assignment date fields this tool edits. The tuple
 * order matches how they appear in the UI (left-to-right in the
 * preview table and the bulk-op controls).
 */
export const DATE_FIELDS = ["due_at", "unlock_at", "lock_at"] as const
export type DateField = (typeof DATE_FIELDS)[number]

/**
 * Per-field bulk operation the teacher picks for every selected row:
 * - "keep": leave the field alone
 * - "set": set every selected row to `value` (absolute ISO UTC)
 * - "shift_days": add N days to each row's current value (drop the row
 *   if its current value is null so we don't fabricate dates)
 * - "clear": set the field to null on Canvas
 */
export type DateOpKind = "keep" | "set" | "shift_days" | "clear"

export interface DateOp {
  kind: DateOpKind
  /** Local datetime string `YYYY-MM-DDTHH:MM` for `kind === "set"`. */
  setLocal?: string
  /** Signed integer for `kind === "shift_days"`. */
  shiftDays?: number
}

/** Payload sent to the backend per-field per-assignment. */
export interface FieldUpdate {
  action: "keep" | "set" | "clear"
  value?: string | null
}

export interface DateUpdateItem {
  id: number
  due_at: FieldUpdate
  unlock_at: FieldUpdate
  lock_at: FieldUpdate
}

export type DateUpdateEvent =
  | { kind: "start"; total: number }
  | {
      kind: "updated"
      index: number
      assignment_id: number
      committed: Partial<Record<DateField, string | null>>
    }
  | {
      kind: "error"
      index?: number
      assignment_id?: number
      error: string
    }
  | { kind: "done"; updated: number }
