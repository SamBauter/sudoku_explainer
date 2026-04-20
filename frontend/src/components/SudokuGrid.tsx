import { AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import type { Board, Candidates } from "@/types"

import { SudokuCell } from "./SudokuCell"

export type UnderAxis = "row" | "col" | "box"

export interface UnderMarkers {
  row: Record<number, number[]>
  col: Record<number, number[]>
  box: Record<number, number[]>
}

interface SudokuGridProps {
  board: Board
  clueMask: boolean[][]
  solvedMask: boolean[][]
  violationMask: boolean[][]
  freebieMask: boolean[][]
  knockOnMask: boolean[][]
  underMarkers: UnderMarkers
  onUnderMarkerClick: (
    axis: UnderAxis,
    axisIndex0: number,
    digits: number[],
  ) => void
  candidates: Candidates | null
  selected: { r: number; c: number } | null
  onSelect: (r: number, c: number) => void
  onPickCandidate: (r: number, c: number, value: number) => void
}

function AxisMarker({
  axis,
  axisIndex0,
  digits,
  onClick,
  className,
}: {
  axis: UnderAxis
  axisIndex0: number
  digits: number[] | undefined
  onClick: (axis: UnderAxis, axisIndex0: number, digits: number[]) => void
  className?: string
}) {
  if (!digits || digits.length === 0) return <div className={className} />
  const axisLabel = axis === "row" ? "Row" : axis === "col" ? "Column" : "Box"
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <button
        type="button"
        aria-label={`${axisLabel} ${axisIndex0 + 1} is missing digits ${digits.join(", ")}`}
        title="Missing digit — click for details"
        onClick={(e) => {
          e.stopPropagation()
          onClick(axis, axisIndex0, digits)
        }}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full",
          "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-500/80 shadow-sm",
          "transition-colors hover:bg-yellow-200 hover:text-yellow-900",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500",
          "cursor-pointer",
        )}
      >
        <AlertTriangle className="size-3" />
      </button>
    </div>
  )
}

export function SudokuGrid({
  board,
  clueMask,
  solvedMask,
  violationMask,
  freebieMask,
  knockOnMask,
  underMarkers,
  onUnderMarkerClick,
  candidates,
  selected,
  onSelect,
  onPickCandidate,
}: SudokuGridProps) {
  // Layout is a 2-column × 2-row outer grid:
  // ┌──────┬─────────────── column markers ──────────────────┐
  // │  ·   │ 9 equal-width icon slots                        │
  // ├──────┼─────────────────────────────────────────────────┤
  // │ row  │ the existing 9×9 glass cell grid                │
  // │ mkrs │                                                 │
  // └──────┴─────────────────────────────────────────────────┘
  // The outer padding on the glass container (p-2) is matched by the
  // gutters' own padding so marker slots line up with cell rows/columns.
  return (
    <div className="mx-auto w-full max-w-[600px]">
      <div className="grid grid-cols-[1.75rem_1fr]">
        <div aria-hidden />
        <div className="grid grid-cols-9 px-2 pb-1">
          {Array.from({ length: 9 }, (_, c) => (
            <AxisMarker
              key={`col-${c}`}
              axis="col"
              axisIndex0={c}
              digits={underMarkers.col[c]}
              onClick={onUnderMarkerClick}
              className="h-6"
            />
          ))}
        </div>
        <div className="grid grid-rows-9 py-2 pr-1">
          {Array.from({ length: 9 }, (_, r) => (
            <AxisMarker
              key={`row-${r}`}
              axis="row"
              axisIndex0={r}
              digits={underMarkers.row[r]}
              onClick={onUnderMarkerClick}
              className="w-6"
            />
          ))}
        </div>
        <div className="glass-strong overflow-hidden rounded-2xl p-2">
          <div className="grid grid-cols-9 overflow-hidden rounded-xl ring-1 ring-white/60">
            {board.flatMap((row, r) =>
              row.map((value, c) => {
                const isBoxTopLeft = r % 3 === 0 && c % 3 === 0
                const boxIdx = Math.floor(r / 3) * 3 + Math.floor(c / 3)
                const boxDigits = isBoxTopLeft
                  ? underMarkers.box[boxIdx]
                  : undefined
                const boxMarker =
                  boxDigits && boxDigits.length > 0
                    ? {
                        digits: boxDigits,
                        onClick: () =>
                          onUnderMarkerClick("box", boxIdx, boxDigits),
                      }
                    : null
                return (
                  <SudokuCell
                    key={`${r}-${c}`}
                    row={r}
                    col={c}
                    value={value}
                    isClue={clueMask[r][c]}
                    isSolved={solvedMask[r][c]}
                    isViolation={violationMask[r][c]}
                    isFreebie={freebieMask[r][c]}
                    isKnockOn={knockOnMask[r][c]}
                    selected={selected?.r === r && selected?.c === c}
                    candidates={candidates ? candidates[r][c] : null}
                    boxMarker={boxMarker}
                    onSelect={onSelect}
                    onPickCandidate={onPickCandidate}
                  />
                )
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
