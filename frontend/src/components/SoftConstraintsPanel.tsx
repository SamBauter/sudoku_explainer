import { ChevronDown, ChevronUp, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Axis, SoftConfig, SoftMode } from "@/types"

interface SoftConstraintsPanelProps {
  enabled: boolean
  expanded: boolean
  mode: SoftMode
  config: SoftConfig
  onToggleEnabled: (enabled: boolean) => void
  onToggleExpanded: () => void
  onModeChange: (mode: SoftMode) => void
  onToggleValue: (axis: Axis, value: number) => void
  onClear: () => void
}

const AXIS_LABELS: Record<Axis, string> = {
  rows: "Allow duplicates in rows",
  cols: "Allow duplicates in columns",
  boxes: "Allow duplicates in 3x3 boxes",
}

function AxisStrip({
  axis,
  selected,
  disabled,
  onToggleValue,
}: {
  axis: Axis
  selected: number[]
  disabled: boolean
  onToggleValue: (axis: Axis, value: number) => void
}) {
  const set = new Set(selected)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {AXIS_LABELS[axis]}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => {
          const active = set.has(v)
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => onToggleValue(axis, v)}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-md border text-sm tabular-nums transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-input bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground",
              )}
              aria-pressed={active}
              aria-label={`Toggle ${v} for ${axis}`}
            >
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ModeTab({
  active,
  label,
  description,
  onClick,
  disabled,
}: {
  active: boolean
  label: string
  description: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-primary bg-primary/10 text-foreground shadow-xs"
          : "border-input bg-background/60 text-muted-foreground hover:border-primary/60 hover:text-foreground",
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] leading-snug">{description}</span>
    </button>
  )
}

export function SoftConstraintsPanel({
  enabled,
  expanded,
  mode,
  config,
  onToggleEnabled,
  onToggleExpanded,
  onModeChange,
  onToggleValue,
  onClear,
}: SoftConstraintsPanelProps) {
  const anySelected =
    config.rows.length + config.cols.length + config.boxes.length > 0
  const showAxisStrips = mode === "specific"
  return (
    <div className="rounded-md border bg-muted/30">
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={enabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
            />
            Enable soft constraints
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            The solver will penalize extra placements and still look for the
            solution that respects the most Sudoku rules.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {enabled && showAxisStrips && anySelected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 px-2 text-xs"
            >
              <X className="size-3.5" />
              Clear rules
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleExpanded}
            className="h-7 px-2 text-xs"
            aria-label={expanded ? "Collapse rules" : "Expand rules"}
          >
            {expanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {expanded ? "Hide rules" : "Show rules"}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="flex flex-col gap-3 border-t px-3 py-3">
          <div
            role="radiogroup"
            aria-label="Soft constraint mode"
            className="flex flex-col gap-2 sm:flex-row"
          >
            <ModeTab
              active={mode === "specific"}
              label="Soften specific rules"
              description="Pick which row/column/box duplicates are allowed. Other placements remain hard and are blocked on input."
              onClick={() => onModeChange("specific")}
              disabled={!enabled}
            />
            <ModeTab
              active={mode === "penalize_all"}
              label="Penalise all violations"
              description="Type anything — every Sudoku rule becomes a weight-1 penalty. The solver minimises total rule breaks; use the LP inspector to see what it bent."
              onClick={() => onModeChange("penalize_all")}
              disabled={!enabled}
            />
          </div>

          {showAxisStrips ? (
            <>
              <p className="text-xs text-muted-foreground">
                Pick which values are allowed to appear more than once on
                each axis. The solver minimises extra placements for values
                you did <em>not</em> soften, so it still prefers a valid
                Sudoku wherever possible.
              </p>
              <AxisStrip
                axis="rows"
                selected={config.rows}
                disabled={!enabled}
                onToggleValue={onToggleValue}
              />
              <AxisStrip
                axis="cols"
                selected={config.cols}
                disabled={!enabled}
                onToggleValue={onToggleValue}
              />
              <AxisStrip
                axis="boxes"
                selected={config.boxes}
                disabled={!enabled}
                onToggleValue={onToggleValue}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Input is unrestricted in this mode — type any digit in any
              cell. Duplicates are highlighted on the grid and every
              over / under slack the solver introduces shows up in the LP
              inspector so you can see which rules it chose to break.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
