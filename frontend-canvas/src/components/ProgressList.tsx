import { AlertTriangle, CheckCircle2, Circle } from "lucide-react"

import { cn } from "@/lib/utils"
import type { PolicyKind, ProgressEvent } from "@/types"

interface ProgressListProps {
  events: ProgressEvent[]
  kind: PolicyKind
}

type Row =
  | {
      kind: "done"
      index: number
      name: string
      cleared: number
      scanned: number
      skipped: number
    }
  | {
      kind: "error"
      index: number
      name: string
      error: string
    }

function rowsFromEvents(events: ProgressEvent[]): Row[] {
  const rows: Row[] = []
  for (const ev of events) {
    if (ev.kind === "assignment_done") {
      rows.push({
        kind: "done",
        index: ev.index,
        name: ev.assignment_name ?? `Assignment ${ev.assignment_id}`,
        cleared: ev.stats.cleared,
        scanned: ev.stats.scanned,
        skipped: ev.stats.skipped,
      })
    } else if (ev.kind === "assignment_error") {
      rows.push({
        kind: "error",
        index: ev.index ?? rows.length + 1,
        name:
          ev.assignment_name ??
          (ev.assignment_id ? `Assignment ${ev.assignment_id}` : "Unknown"),
        error: ev.error,
      })
    }
  }
  return rows
}

function total(events: ProgressEvent[]): number | null {
  const start = events.find((e) => e.kind === "start")
  return start?.kind === "start" ? start.total_assignments : null
}

export function ProgressList({ events, kind }: ProgressListProps) {
  const rows = rowsFromEvents(events)
  const totalAssignments = total(events)
  const isRunning = !events.some((e) => e.kind === "done")
  const pending =
    totalAssignments !== null ? totalAssignments - rows.length : null
  const flagLabel = kind === "missing" ? "missing" : "late"

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "glass-subtle flex items-start gap-3 rounded-lg px-3 py-2 text-sm",
            r.kind === "error" && "border-destructive/30",
          )}
        >
          {r.kind === "done" ? (
            <CheckCircle2 className="text-emerald-600 mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <div className="truncate font-medium">
                <span className="text-muted-foreground mr-1.5 font-mono">
                  #{r.index}
                </span>
                {r.name}
              </div>
              {r.kind === "done" ? (
                <div className="text-muted-foreground whitespace-nowrap text-xs">
                  {r.scanned} scanned · {r.skipped} skipped
                </div>
              ) : null}
            </div>
            {r.kind === "done" ? (
              r.cleared > 0 ? (
                <div className="text-emerald-700 text-xs">
                  Cleared {flagLabel} on {r.cleared}{" "}
                  {r.cleared === 1 ? "submission" : "submissions"}
                </div>
              ) : (
                <div className="text-muted-foreground text-xs">
                  Nothing to clear
                </div>
              )
            ) : (
              <div className="text-destructive break-words text-xs">
                {r.error}
              </div>
            )}
          </div>
        </div>
      ))}

      {isRunning && pending !== null && pending > 0 ? (
        <div className="glass-subtle text-muted-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
          <Circle className="size-4 animate-pulse" />
          {pending} assignment{pending === 1 ? "" : "s"} remaining&hellip;
        </div>
      ) : null}
    </div>
  )
}
