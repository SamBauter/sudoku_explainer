import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { LpInspector } from "@/components/LpInspector"
import { SoftConstraintsPanel } from "@/components/SoftConstraintsPanel"
import { SudokuGrid } from "@/components/SudokuGrid"
import { Toolbar } from "@/components/Toolbar"
import { Card, CardContent } from "@/components/ui/card"
import { Toaster } from "@/components/ui/sonner"
import { fetchExample, solveBoard } from "@/lib/api"
import {
  cloneBoard,
  computeCandidates,
  computeDuplicateMasks,
  computeViolationMask,
  EMPTY_BOARD,
  EMPTY_SOFT_CONFIG,
  hasSoftConfig,
  placementConflicts,
} from "@/lib/sudoku"
import type { Axis, Board, Penalty, SoftConfig, SoftMode } from "@/types"

const AXIS_OPTION_LABEL: Record<Axis, string> = {
  rows: "Allow duplicates in rows",
  cols: "Allow duplicates in columns",
  boxes: "Allow duplicates in 3×3 boxes",
}

function emptyMask(): boolean[][] {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => false))
}

export default function App() {
  // The clue board is the ground truth of user-entered values. ``solvedBoard``
  // overlays the latest solver output; ``previousSolutions`` is accumulated so
  // the "Find next solution" action can forbid them via the exclusion
  // constraint on the backend. Editing any clue resets both.
  const [clues, setClues] = useState<Board>(() => cloneBoard(EMPTY_BOARD))
  const [solvedBoard, setSolvedBoard] = useState<Board | null>(null)
  const [previousSolutions, setPreviousSolutions] = useState<Board[]>([])
  const [selected, setSelected] = useState<{ r: number; c: number } | null>({
    r: 0,
    c: 0,
  })
  const [solving, setSolving] = useState(false)
  const [showCandidates, setShowCandidates] = useState(true)
  const [softEnabled, setSoftEnabled] = useState(false)
  const [softPanelExpanded, setSoftPanelExpanded] = useState(false)
  const [softMode, setSoftMode] = useState<SoftMode>("specific")
  const [softConfig, setSoftConfig] = useState<SoftConfig>(EMPTY_SOFT_CONFIG)
  const [lastSolve, setLastSolve] = useState<{
    violations: number
    objective: number
    penalties: Penalty[]
  } | null>(null)

  const displayBoard = solvedBoard ?? clues

  const clueMask = useMemo(
    () => clues.map((row) => row.map((v) => v !== 0)),
    [clues],
  )
  const solvedMask = useMemo(() => {
    if (!solvedBoard) return emptyMask()
    return solvedBoard.map((row, r) =>
      row.map((v, c) => v !== 0 && clues[r][c] === 0),
    )
  }, [solvedBoard, clues])

  // The soft config sent to the solver and used for UI highlighting. In
  // penalise-all mode we strip the per-axis freebie lists so they don't
  // leak weight-0 slacks into the model (everything should be weight 1).
  const effectiveSoftConfig = useMemo<SoftConfig>(() => {
    if (!softEnabled) return EMPTY_SOFT_CONFIG
    if (softMode === "penalize_all") {
      return { rows: [], cols: [], boxes: [], penalize_all: true }
    }
    return { ...softConfig, penalize_all: false }
  }, [softEnabled, softMode, softConfig])

  const isPenaliseAll = softEnabled && softMode === "penalize_all"

  // In penalise-all mode we render rose for cells the user typed (clues)
  // that duplicate on any axis, and yellow for solver-placed duplicates.
  // In specific-softening mode the user-softened duplicates are "freebies"
  // (weight-0 slacks, no penalty) so they get a separate sky-blue tint with
  // red digits — the grid matches the LP inspector's freebie colour.
  const duplicateMasks = useMemo(
    () => (isPenaliseAll ? computeDuplicateMasks(displayBoard, clueMask) : null),
    [isPenaliseAll, displayBoard, clueMask],
  )

  // Rose on the grid means "this cell is part of a rule break the solver
  // paid for". Only penalise-all mode produces these on the board today
  // (clue duplicates). In specific-softening mode rule breaks are caught
  // at the input-validation stage, so this mask is empty there.
  const violationMask = useMemo(() => {
    if (duplicateMasks) return duplicateMasks.clueDup
    return emptyMask()
  }, [duplicateMasks])

  // Sky-blue "freebie" highlight: only shown in specific-softening mode,
  // where a duplicate on a user-opted axis/digit costs zero in the
  // objective. Empty in penalise-all mode (no freebies in that mode).
  const freebieMask = useMemo(() => {
    if (isPenaliseAll) return emptyMask()
    return computeViolationMask(displayBoard, effectiveSoftConfig)
  }, [isPenaliseAll, displayBoard, effectiveSoftConfig])

  // Mask of cells that were placed as knock-on effects of the softening.
  //
  // * Specific-softening mode: any non-zero weight-1 ``over_*`` slack from
  //   the last solve implies that the corresponding axis has too many of a
  //   particular digit, and every cell on that axis carrying that digit is
  //   part of the knock-on.
  // * Penalise-all mode: solver-placed (non-clue) cells whose value
  //   duplicates on any axis. Clue duplicates go into the rose mask above.
  const knockOnMask = useMemo(() => {
    if (duplicateMasks) return duplicateMasks.nonClueDup
    const mask = emptyMask()
    if (!lastSolve || !solvedBoard) return mask
    for (const p of lastSolve.penalties) {
      if (p.value <= 0 || p.weight <= 0 || p.kind !== "over") continue
      if (p.axis === "row") {
        const r = p.axis_index - 1
        for (let c = 0; c < 9; c++) {
          if (displayBoard[r][c] === p.digit) mask[r][c] = true
        }
      } else if (p.axis === "col") {
        const c = p.axis_index - 1
        for (let r = 0; r < 9; r++) {
          if (displayBoard[r][c] === p.digit) mask[r][c] = true
        }
      } else {
        const bIdx = p.axis_index - 1
        const br = Math.floor(bIdx / 3) * 3
        const bc = (bIdx % 3) * 3
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const r = br + i
            const c = bc + j
            if (displayBoard[r][c] === p.digit) mask[r][c] = true
          }
        }
      }
    }
    return mask
  }, [duplicateMasks, displayBoard, lastSolve, solvedBoard])

  // Missing-digit markers: any fired ``under_*`` slack means the axis has
  // zero copies of that digit. We group them by axis + axis-index so the UI
  // shows one exclamation icon per row/column/box, listing every missing
  // digit in a click-triggered toast.
  const underMarkers = useMemo(() => {
    const markers: {
      row: Record<number, number[]>
      col: Record<number, number[]>
      box: Record<number, number[]>
    } = { row: {}, col: {}, box: {} }
    if (!lastSolve) return markers
    for (const p of lastSolve.penalties) {
      if (p.kind !== "under" || p.value <= 0) continue
      const key = p.axis_index - 1
      const bucket = markers[p.axis]
      const existing = bucket[key] ?? []
      existing.push(p.digit)
      bucket[key] = existing
    }
    for (const bucket of [markers.row, markers.col, markers.box]) {
      for (const k of Object.keys(bucket)) {
        bucket[Number(k)].sort((a, b) => a - b)
      }
    }
    return markers
  }, [lastSolve])

  const handleUnderMarkerClick = useCallback(
    (axis: "row" | "col" | "box", axisIndex0: number, digits: number[]) => {
      const axisLabel =
        axis === "row" ? "Row" : axis === "col" ? "Column" : "Box"
      const axisIndex1 = axisIndex0 + 1
      const sentences = digits.map(
        (d) => `${axisLabel} ${axisIndex1} has less than one ${d}.`,
      )
      const id = `under-${axis}-${axisIndex0}`
      const body = (
        <div
          className="flex cursor-pointer flex-col gap-2"
          onClick={() => toast.dismiss(id)}
        >
          {sentences.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      )
      toast.warning(body, {
        id,
        duration:
          sentences.length > 1 ? 4000 + sentences.length * 3000 : undefined,
      })
    },
    [],
  )

  // Penalty names whose axis includes at least one clue carrying the
  // digit. Only meaningful in penalise-all mode — those rows will render
  // rose in the LP inspector to match the grid highlight. Unders never
  // map to a visible cell, so they can't be "user-caused".
  const userCausedPenalties = useMemo(() => {
    const set = new Set<string>()
    if (!isPenaliseAll || !lastSolve) return set
    for (const p of lastSolve.penalties) {
      if (p.value <= 0 || p.kind !== "over") continue
      let hasClue = false
      if (p.axis === "row") {
        const r = p.axis_index - 1
        for (let c = 0; c < 9; c++) {
          if (displayBoard[r][c] === p.digit && clueMask[r][c]) {
            hasClue = true
            break
          }
        }
      } else if (p.axis === "col") {
        const c = p.axis_index - 1
        for (let r = 0; r < 9; r++) {
          if (displayBoard[r][c] === p.digit && clueMask[r][c]) {
            hasClue = true
            break
          }
        }
      } else {
        const bIdx = p.axis_index - 1
        const br = Math.floor(bIdx / 3) * 3
        const bc = (bIdx % 3) * 3
        outer: for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const r = br + i
            const c = bc + j
            if (displayBoard[r][c] === p.digit && clueMask[r][c]) {
              hasClue = true
              break outer
            }
          }
        }
      }
      if (hasClue) set.add(p.name)
    }
    return set
  }, [isPenaliseAll, lastSolve, displayBoard, clueMask])

  const candidates = useMemo(() => {
    if (!showCandidates) return null
    return computeCandidates(displayBoard)
  }, [displayBoard, showCandidates])

  const handleSelect = useCallback((r: number, c: number) => {
    setSelected({ r, c })
  }, [])

  const setCell = useCallback(
    (r: number, c: number, value: number) => {
      // Block typing a value that would duplicate an existing entry on any
      // axis the user hasn't opted into via the soft-constraint panel. If the
      // user is re-typing the same value, we short-circuit and keep the
      // existing cell state untouched without surfacing an error.
      //
      // In penalise-all mode input is completely free: the solver will just
      // pay the penalty for any rule the user breaks, so we skip validation
      // entirely and never surface conflict toasts.
      const unrestricted = softEnabled && softMode === "penalize_all"
      if (!unrestricted && value !== 0 && clues[r][c] !== value) {
        const conflicts = placementConflicts(clues, r, c, value)
        const blocked = conflicts.filter(
          (axis) => !softEnabled || !softConfig[axis].includes(value),
        )
        if (blocked.length > 0) {
          const boxNumber =
            Math.floor(r / 3) * 3 + Math.floor(c / 3) + 1
          const sentences = blocked.map((axis) => {
            const option = `“${AXIS_OPTION_LABEL[axis]}”`
            if (axis === "rows") {
              return `Cannot place ${value} in row ${r + 1}: a ${value} already exists in this row. Enable ${option} for ${value} to allow this.`
            }
            if (axis === "cols") {
              return `Cannot place ${value} in column ${c + 1}: a ${value} already exists in this column. Enable ${option} for ${value} to allow this.`
            }
            return `Cannot place ${value} in 3×3 box ${boxNumber}: a ${value} already exists in this box. Enable ${option} for ${value} to allow this.`
          })
          const toastId = `placement-conflict-${r}-${c}-${value}`
          const body = (
            <div
              className="flex cursor-pointer flex-col gap-2"
              onClick={() => toast.dismiss(toastId)}
            >
              {sentences.map((sentence, i) => (
                <p key={i}>{sentence}</p>
              ))}
            </div>
          )
          toast.error(body, {
            id: toastId,
            // Single-conflict toasts keep Sonner's default duration; multi-
            // conflict toasts stay on screen proportionally longer so the
            // user has time to read every sentence.
            duration: blocked.length > 1 ? 4000 + blocked.length * 3000 : undefined,
          })
          return
        }
      }

      setClues((prev) => {
        if (prev[r][c] === value) return prev
        const next = cloneBoard(prev)
        next[r][c] = value
        return next
      })
      setSolvedBoard(null)
      setPreviousSolutions([])
      setLastSolve(null)
    },
    [clues, softEnabled, softMode, softConfig],
  )

  // Changing the soft-constraint configuration invalidates any solution that
  // was computed under the previous settings (including the exclusion list),
  // so we wipe them whenever the config changes.
  const invalidateSolutions = useCallback(() => {
    setSolvedBoard(null)
    setPreviousSolutions([])
    setLastSolve(null)
  }, [])

  const handleToggleSoftEnabled = useCallback(
    (enabled: boolean) => {
      setSoftEnabled(enabled)
      setSoftPanelExpanded(enabled)
      invalidateSolutions()
    },
    [invalidateSolutions],
  )

  const handleSoftModeChange = useCallback(
    (mode: SoftMode) => {
      setSoftMode(mode)
      invalidateSolutions()
    },
    [invalidateSolutions],
  )

  const handleToggleSoftValue = useCallback(
    (axis: Axis, value: number) => {
      setSoftConfig((prev) => {
        const list = prev[axis]
        const next = list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value].sort((a, b) => a - b)
        return { ...prev, [axis]: next }
      })
      invalidateSolutions()
    },
    [invalidateSolutions],
  )

  const handleClearSoftConfig = useCallback(() => {
    setSoftConfig(EMPTY_SOFT_CONFIG)
    invalidateSolutions()
  }, [invalidateSolutions])

  const handlePickCandidate = useCallback(
    (r: number, c: number, value: number) => {
      setSelected({ r, c })
      setCell(r, c, value)
    },
    [setCell],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selected) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return
      }
      const { r, c } = selected
      if (e.key >= "1" && e.key <= "9") {
        setCell(r, c, Number(e.key))
        e.preventDefault()
        return
      }
      if (
        e.key === "Backspace" ||
        e.key === "Delete" ||
        e.key === "0" ||
        e.key === " "
      ) {
        setCell(r, c, 0)
        e.preventDefault()
        return
      }
      const moves: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      }
      if (moves[e.key]) {
        const [dr, dc] = moves[e.key]
        setSelected({
          r: Math.min(8, Math.max(0, r + dr)),
          c: Math.min(8, Math.max(0, c + dc)),
        })
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selected, setCell])

  const handleLoadExample = useCallback(async () => {
    try {
      const { board: ex } = await fetchExample()
      setClues(ex)
      setSolvedBoard(null)
      setPreviousSolutions([])
      setLastSolve(null)
      toast.success("Loaded the Wikipedia example puzzle.")
    } catch (err) {
      toast.error(`Failed to load example: ${(err as Error).message}`)
    }
  }, [])

  const handleSolve = useCallback(async () => {
    setSolving(true)
    const softForRequest = hasSoftConfig(effectiveSoftConfig)
      ? effectiveSoftConfig
      : null
    try {
      const { status, solved, violations, objective, penalties } =
        await solveBoard(clues, previousSolutions, softForRequest)
      if (status !== "ok" || !solved) {
        toast.error(
          previousSolutions.length > 0
            ? "No more solutions exist for this board."
            : "No solution exists for this board.",
        )
        return
      }
      setSolvedBoard(solved)
      setPreviousSolutions((prev) => [...prev, solved])
      setLastSolve({ violations, objective, penalties })
      const label =
        previousSolutions.length > 0
          ? `Found another solution (#${previousSolutions.length + 1})`
          : "Solved"
      const suffix =
        softForRequest && violations > 0
          ? ` with ${violations} extra placement${violations === 1 ? "" : "s"}`
          : ""
      toast.success(`${label}${suffix}.`)
    } catch (err) {
      toast.error(`Solve failed: ${(err as Error).message}`)
    } finally {
      setSolving(false)
    }
  }, [clues, previousSolutions, effectiveSoftConfig])

  const handleClear = useCallback(() => {
    setClues(cloneBoard(EMPTY_BOARD))
    setSolvedBoard(null)
    setPreviousSolutions([])
    setLastSolve(null)
  }, [])

  return (
    <div className="min-h-full px-4 py-10 sm:py-14">
      <Toaster richColors position="top-right" />
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col items-start gap-3">
          <h1 className="bg-gradient-to-br from-white via-white to-sky-100 bg-clip-text text-5xl font-bold tracking-tight text-transparent drop-shadow-[0_3px_14px_rgba(0,0,0,0.4)] sm:text-6xl">
            Sudoku LP Solver
          </h1>
          <p className="text-base font-medium tracking-wide text-white/90 drop-shadow-[0_1px_6px_rgba(0,0,0,0.35)] sm:text-lg">
            Powered by{" "}
            <span className="font-semibold text-white">PuLP</span>.
          </p>
        </header>

        <Card className="glass rounded-2xl border-0 bg-transparent py-7 shadow-none">
          <CardContent className="flex flex-col gap-5">
            <SoftConstraintsPanel
              enabled={softEnabled}
              expanded={softPanelExpanded}
              mode={softMode}
              config={softConfig}
              onToggleEnabled={handleToggleSoftEnabled}
              onToggleExpanded={() => setSoftPanelExpanded((v) => !v)}
              onModeChange={handleSoftModeChange}
              onToggleValue={handleToggleSoftValue}
              onClear={handleClearSoftConfig}
            />
            <LpInspector
              objective={lastSolve?.objective ?? null}
              penalties={lastSolve?.penalties ?? []}
              userCausedPenalties={userCausedPenalties}
            />
            {solvedBoard && lastSolve !== null && (
              <div
                className={
                  lastSolve.violations > 0
                    ? "rounded-md border border-rose-300/70 bg-rose-100/70 px-3 py-2 text-sm text-rose-800"
                    : "rounded-md border border-emerald-300/70 bg-emerald-100/70 px-3 py-2 text-sm text-emerald-800"
                }
              >
                {lastSolve.violations > 0
                  ? `Soft mode: ${lastSolve.violations} extra placement${lastSolve.violations === 1 ? "" : "s"} used. Violating cells are highlighted below.`
                  : "Soft mode: solver found a fully valid Sudoku with zero extra placements."}
              </div>
            )}
            <Toolbar
              onLoadExample={handleLoadExample}
              onSolve={handleSolve}
              onClear={handleClear}
              onToggleCandidates={() => setShowCandidates((v) => !v)}
              showCandidates={showCandidates}
              solving={solving}
              hasSolution={solvedBoard !== null}
            />
            <SudokuGrid
              board={displayBoard}
              clueMask={clueMask}
              solvedMask={solvedMask}
              violationMask={violationMask}
              freebieMask={freebieMask}
              knockOnMask={knockOnMask}
              underMarkers={underMarkers}
              onUnderMarkerClick={handleUnderMarkerClick}
              candidates={candidates}
              selected={selected}
              onSelect={handleSelect}
              onPickCandidate={handlePickCandidate}
            />
            <Legend />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="glass-subtle flex flex-wrap items-center gap-6 rounded-xl px-4 py-3 text-sm text-slate-700">
      <span className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center font-semibold text-slate-900">
          5
        </span>
        Clue (your input)
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center text-sky-600 dark:text-sky-400">
          5
        </span>
        Solver output
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-grid size-5 grid-cols-3 grid-rows-3 text-[7px] leading-none">
          <span>1</span>
          <span className="opacity-0">2</span>
          <span>3</span>
          <span className="opacity-0">4</span>
          <span>5</span>
          <span className="opacity-0">6</span>
          <span>7</span>
          <span className="opacity-0">8</span>
          <span>9</span>
        </span>
        Candidates (click to set)
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center rounded bg-rose-200/70 font-semibold text-rose-700">
          5
        </span>
        Penalised violation
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center rounded bg-sky-300/60 font-semibold text-rose-700">
          5
        </span>
        Softened rule, no penalty
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-flex size-5 items-center justify-center rounded bg-yellow-200/70 font-semibold text-yellow-800">
          5
        </span>
        Knock-on effect
      </span>
    </div>
  )
}
