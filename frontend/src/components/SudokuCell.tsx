import { AlertTriangle } from "lucide-react"
import { memo } from "react"

import { cn } from "@/lib/utils"

interface BoxMarker {
  digits: number[]
  onClick: () => void
}

interface SudokuCellProps {
  row: number
  col: number
  value: number
  isClue: boolean
  isSolved: boolean
  isViolation: boolean
  isFreebie: boolean
  isKnockOn: boolean
  selected: boolean
  candidates: number[] | null
  /**
   * When set, renders a yellow exclamation in the top-left corner of this
   * cell to flag a box with missing digits. Only the top-left cell of a
   * 3×3 box ever receives a marker.
   */
  boxMarker?: BoxMarker | null
  onSelect: (row: number, col: number) => void
  onPickCandidate: (row: number, col: number, value: number) => void
}

function cellBorders(row: number, col: number): string {
  const classes: string[] = []
  classes.push("border-r border-b border-white/55")
  if (col === 0) classes.push("border-l")
  if (row === 0) classes.push("border-t")
  // Thicker, slightly darker separators between 3x3 boxes.
  if ((col + 1) % 3 === 0 && col !== 8)
    classes.push("!border-r-2 !border-r-slate-400/70")
  if ((row + 1) % 3 === 0 && row !== 8)
    classes.push("!border-b-2 !border-b-slate-400/70")
  // Round the four outermost corner cells to match the grid's rounded-xl
  // frame. Without this, the selected-cell ring / violation / freebie /
  // knock-on backgrounds in those corners render as a square inside the
  // rounded grid and get visibly clipped by the parent's overflow-hidden.
  if (row === 0 && col === 0) classes.push("rounded-tl-xl")
  if (row === 0 && col === 8) classes.push("rounded-tr-xl")
  if (row === 8 && col === 0) classes.push("rounded-bl-xl")
  if (row === 8 && col === 8) classes.push("rounded-br-xl")
  return classes.join(" ")
}

interface PencilMarksProps {
  candidates: number[]
  interactive: boolean
  onPick: (value: number) => void
}

function PencilMarks({ candidates, interactive, onPick }: PencilMarksProps) {
  const set = new Set(candidates)
  return (
    // When the cell is not yet selected, the pencil grid is purely decorative:
    // ``pointer-events-none`` lets every click fall through to the parent cell
    // so the first click always selects. Once selected, available digits
    // become clickable shortcuts for setting the cell's value.
    <div
      className={cn(
        "grid h-full w-full grid-cols-3 grid-rows-3 gap-0.5 p-1 text-[10px] leading-none",
        !interactive && "pointer-events-none",
      )}
    >
      {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => {
        const available = set.has(v)
        if (!interactive) {
          return (
            <span
              key={v}
              className={cn(
                "flex items-center justify-center rounded-sm tabular-nums",
                available ? "text-slate-500" : "text-transparent",
              )}
            >
              {v}
            </span>
          )
        }
        return (
          <button
            key={v}
            type="button"
            tabIndex={-1}
            disabled={!available}
            onClick={(e) => {
              e.stopPropagation()
              if (available) onPick(v)
            }}
            className={cn(
              "flex items-center justify-center rounded-sm tabular-nums transition-colors",
              available
                ? "cursor-pointer text-slate-500 hover:bg-white/70 hover:text-slate-900 hover:ring-1 hover:ring-slate-400/60"
                : "cursor-default text-transparent",
            )}
            aria-label={available ? `Set to ${v}` : undefined}
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}

function SudokuCellImpl({
  row,
  col,
  value,
  isClue,
  isSolved,
  isViolation,
  isFreebie,
  isKnockOn,
  selected,
  candidates,
  boxMarker,
  onSelect,
  onPickCandidate,
}: SudokuCellProps) {
  const hasValue = value !== 0
  const showPencil = !hasValue && candidates && candidates.length > 0
  const cellTitle = isViolation
    ? "Duplicate placement: this cell's value breaks a Sudoku rule and is counted in the objective."
    : isFreebie
      ? "Softened rule, no penalty: you opted into this duplicate, so it costs zero in the objective."
      : isKnockOn
        ? "Knock-on effect: the solver placed this digit here to balance a softened or forced duplicate elsewhere."
        : undefined
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Cell r${row + 1}c${col + 1}`}
      title={cellTitle}
      onClick={() => onSelect(row, col)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelect(row, col)
          e.preventDefault()
        }
      }}
      className={cn(
        "relative flex aspect-square items-center justify-center text-2xl tabular-nums transition-colors",
        "bg-white/35 focus:outline-none",
        cellBorders(row, col),
        // Highlight precedence: a hard penalty (rose) wins over a user-opted
        // freebie (darker sky), which in turn wins over a solver knock-on
        // (yellow). Each lower tier is disabled when a higher one fires so
        // backgrounds and text colours don't collide.
        isViolation && "bg-rose-200/70 dark:bg-rose-950/40",
        isFreebie && !isViolation && "bg-sky-300/60 dark:bg-sky-900/45",
        isKnockOn &&
          !isViolation &&
          !isFreebie &&
          "bg-yellow-200/70 dark:bg-yellow-900/40",
        selected
          ? "z-10 bg-sky-200/45 ring-2 ring-sky-500/70 ring-inset"
          : "hover:bg-white/60",
        isClue && "font-semibold text-slate-900",
        isSolved && !isClue && "font-normal text-sky-600 dark:text-sky-400",
        isViolation && "text-rose-700 dark:text-rose-300",
        // Freebie cells keep red digits — they're still visually flagged as
        // rule-breaking — but the darker blue background signals "no penalty
        // was paid", mirroring the LP inspector's sky-blue freebie colour.
        isFreebie &&
          !isViolation &&
          "font-semibold text-rose-700 dark:text-rose-300",
        isKnockOn &&
          !isViolation &&
          !isFreebie &&
          "font-semibold text-yellow-800 dark:text-yellow-200",
        !hasValue && "cursor-pointer",
      )}
    >
      {boxMarker && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Box is missing digits ${boxMarker.digits.join(", ")}`}
          title="Missing digit in this box — click for details"
          onClick={(e) => {
            e.stopPropagation()
            boxMarker.onClick()
          }}
          className={cn(
            "absolute top-0.5 left-0.5 z-20 inline-flex size-4 items-center justify-center rounded-full",
            "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-500/80 shadow-sm",
            "transition-colors hover:bg-yellow-200 hover:text-yellow-900",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500",
            "cursor-pointer",
          )}
        >
          <AlertTriangle className="size-2.5" />
        </button>
      )}
      {hasValue ? (
        <span>{value}</span>
      ) : showPencil ? (
        <PencilMarks
          candidates={candidates}
          interactive={selected}
          onPick={(v) => onPickCandidate(row, col, v)}
        />
      ) : null}
    </div>
  )
}

export const SudokuCell = memo(SudokuCellImpl)
