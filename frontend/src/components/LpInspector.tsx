import { ChevronDown, ChevronUp } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Penalty } from "@/types"

interface LpInspectorProps {
  /** ``null`` means no solve has run yet for the current clue state. */
  objective: number | null
  penalties: Penalty[]
  /**
   * Names of penalties whose violating cells include a user-entered clue.
   * Populated only in penalise-all mode so those rows render rose —
   * matching the grid's "user duplicate" highlight — instead of yellow.
   */
  userCausedPenalties?: Set<string>
}

const AXIS_PRETTY: Record<Penalty["axis"], string> = {
  row: "Row",
  col: "Column",
  box: "Box",
}

const KIND_TOOLTIP: Record<Penalty["kind"], string> = {
  over: "extra placement of this digit on the axis (> 1)",
  under: "missing placement of this digit on the axis (< 1)",
}

const EMPTY_USER_CAUSED_SET: ReadonlySet<string> = new Set()

function penaltyComparator(a: Penalty, b: Penalty): number {
  // Non-zero slacks first so users see what actually fired; then penalised
  // terms (weight > 0); then a stable axis / digit / kind order for browsing.
  if ((b.value > 0 ? 1 : 0) - (a.value > 0 ? 1 : 0) !== 0)
    return (b.value > 0 ? 1 : 0) - (a.value > 0 ? 1 : 0)
  if (b.weight - a.weight !== 0) return b.weight - a.weight
  const axisOrder = { row: 0, col: 1, box: 2 } as const
  if (axisOrder[a.axis] !== axisOrder[b.axis])
    return axisOrder[a.axis] - axisOrder[b.axis]
  if (a.digit !== b.digit) return a.digit - b.digit
  if (a.axis_index !== b.axis_index) return a.axis_index - b.axis_index
  return a.kind === b.kind ? 0 : a.kind === "over" ? -1 : 1
}

export function LpInspector({
  objective,
  penalties,
  userCausedPenalties,
}: LpInspectorProps) {
  const userCaused = userCausedPenalties ?? EMPTY_USER_CAUSED_SET
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const { sorted, firedCount, freeCount } = useMemo(() => {
    const sorted = [...penalties].sort(penaltyComparator)
    return {
      sorted,
      firedCount: sorted.filter((p) => p.value > 0).length,
      freeCount: sorted.filter((p) => p.weight === 0).length,
    }
  }, [penalties])

  const visible = useMemo(
    () => (showAll ? sorted : sorted.filter((p) => p.value > 0)),
    [sorted, showAll],
  )

  const hasSolve = objective !== null
  const hasSlacks = sorted.length > 0

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">LP inspector</div>
          <p className="text-xs text-muted-foreground">
            Peek at the last solve: the objective value, every over / under
            slack the model introduced for softened axes, and which ones
            actually fired.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="h-7 px-2 text-xs"
          aria-label={expanded ? "Collapse inspector" : "Expand inspector"}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
          {expanded ? "Hide details" : "Show details"}
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          {!hasSolve ? (
            <p className="text-xs text-muted-foreground">
              Run <span className="font-medium">Solve</span> to populate the
              inspector.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Objective" value={formatObjective(objective!)} />
                <Stat
                  label="Non-zero"
                  value={`${firedCount}`}
                  hint="value > 0"
                />
              </div>

              {!hasSlacks ? (
                <p className="text-xs text-muted-foreground">
                  No slack variables were created — the board was solved in
                  hard mode. Enable soft constraints above to introduce
                  over / under slacks.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Showing{" "}
                      <span className="font-medium text-foreground">
                        {visible.length}
                      </span>{" "}
                      of {sorted.length} slack variables
                      {!showAll && firedCount > 0
                        ? ` (only non-zero)`
                        : ""}
                      {freeCount > 0
                        ? ` · ${freeCount} are weight-0 (user-softened)`
                        : ""}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAll((v) => !v)}
                      className="h-6 px-2 text-[11px]"
                    >
                      {showAll ? "Only non-zero" : "Show all"}
                    </Button>
                  </div>

                  {visible.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      All {sorted.length} slacks resolved to zero — the solver
                      found a fully valid Sudoku without spending any of the
                      allowances you enabled.
                    </p>
                  ) : (
                    <PenaltyTable
                      penalties={visible}
                      userCaused={userCaused}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col rounded-md border border-white/60 bg-white/50 px-2 py-1.5 leading-tight">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm text-slate-900">{value}</span>
      {hint && (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      )}
    </div>
  )
}

function PenaltyTable({
  penalties,
  userCaused,
}: {
  penalties: Penalty[]
  userCaused: ReadonlySet<string>
}) {
  const hasUserCaused = penalties.some(
    (p) => p.value > 0 && userCaused.has(p.name),
  )
  const hasKnockOn = penalties.some(
    (p) => p.value > 0 && p.weight > 0 && !userCaused.has(p.name),
  )
  const hasFreebie = penalties.some((p) => p.value > 0 && p.weight === 0)
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-white/60 bg-white/40">
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-left text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-white/80 backdrop-blur">
              <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Variable</th>
                <th className="px-2 py-1.5 text-right font-medium">Value</th>
                <th className="px-2 py-1.5 text-right font-medium">Weight</th>
                <th className="px-2 py-1.5 font-medium">Axis</th>
                <th className="px-2 py-1.5 text-right font-medium">Digit</th>
                <th className="px-2 py-1.5 font-medium">Kind</th>
              </tr>
            </thead>
            <tbody>
              {penalties.map((p) => {
                // Classification (checked in priority order):
                // * ``isUserCaused`` — penalise-all only: the axis has a
                //   clue carrying this digit, so the violation is traceable
                //   to user input. Painted rose to match the grid.
                // * ``isKnockOn``   — non-zero weight-1 slack the solver
                //   accepted to honour either a user freebie (specific
                //   mode) or a clue duplicate (penalise-all); yellow.
                // * ``isFreebie``  — non-zero weight-0 slack: the user
                //   explicitly softened this axis/digit; sky.
                const isUserCaused = p.value > 0 && userCaused.has(p.name)
                const isKnockOn =
                  !isUserCaused && p.value > 0 && p.weight > 0
                const isFreebie = p.value > 0 && p.weight === 0
                return (
                  <tr
                    key={p.name}
                    title={
                      isUserCaused
                        ? "User-caused violation: a clue on this axis carries this digit, so the duplicate traces back to your input."
                        : isKnockOn
                          ? "Knock-on effect: the solver bent this rule to balance another softened or clue-forced duplicate, and paid for it in the objective."
                          : isFreebie
                            ? "User-opted free allowance: fired without cost because this axis/digit was softened."
                            : undefined
                    }
                    className={cn(
                      "border-t border-white/60",
                      isUserCaused &&
                        "border-l-4 border-l-rose-500 bg-rose-100/75",
                      isKnockOn &&
                        "border-l-4 border-l-yellow-500 bg-yellow-100/80",
                      isFreebie &&
                        "border-l-4 border-l-sky-400 bg-sky-100/70",
                    )}
                  >
                    <td
                      className="px-2 py-1 font-mono text-[11px] text-slate-900"
                      title={p.name}
                    >
                      {p.name}
                    </td>
                    <td className="px-2 py-1 text-right font-semibold text-slate-900">
                      {p.value}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-700">
                      {p.weight}
                    </td>
                    <td className="px-2 py-1 text-slate-700">
                      {AXIS_PRETTY[p.axis]} {p.axis_index}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-700">
                      {p.digit}
                    </td>
                    <td
                      className="px-2 py-1 text-slate-700"
                      title={KIND_TOOLTIP[p.kind]}
                    >
                      {p.kind}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <ColorLegend
        showUserCaused={hasUserCaused}
        showKnockOn={hasKnockOn}
        showFreebie={hasFreebie}
      />
    </div>
  )
}

function ColorLegend({
  showUserCaused,
  showKnockOn,
  showFreebie,
}: {
  showUserCaused: boolean
  showKnockOn: boolean
  showFreebie: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {showUserCaused && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border-l-2 border-l-rose-500 bg-rose-100"
          />
          User-caused (clue duplicate)
        </span>
      )}
      {showKnockOn && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border-l-2 border-l-yellow-500 bg-yellow-100"
          />
          Knock-on (penalised, weight 1)
        </span>
      )}
      {showFreebie && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border-l-2 border-l-sky-400 bg-sky-100"
          />
          User-opted freebie (weight 0)
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3 w-3 rounded-sm border border-white/60 bg-white/40"
        />
        Unused slack (value 0)
      </span>
    </div>
  )
}

function formatObjective(v: number): string {
  // Objective values are sums of integer slacks in this model, so they're
  // effectively integers; but guard against floating drift from the solver.
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
