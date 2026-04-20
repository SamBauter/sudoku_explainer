import type { Axis, Board, Candidates, SoftConfig } from "@/types"

export const EMPTY_BOARD: Board = Array.from({ length: 9 }, () =>
  Array.from({ length: 9 }, () => 0),
)

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row])
}

/**
 * Compute pencil-mark candidates via row/column/box elimination.
 *
 * This is a heuristic, NOT the LP-feasibility set: it only prunes values that
 * trivially clash with an existing clue in the same row, column, or 3x3 box.
 * A value may still be kept even when the full Sudoku is actually unsolvable
 * with that value placed there. Kept deliberately lightweight so the UI can
 * recompute instantly on every edit without a round-trip to the solver.
 */
export function computeCandidates(board: Board): Candidates {
  const out: Candidates = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => [] as number[]),
  )

  const rowUsed: Set<number>[] = Array.from({ length: 9 }, () => new Set())
  const colUsed: Set<number>[] = Array.from({ length: 9 }, () => new Set())
  const boxUsed: Set<number>[] = Array.from({ length: 9 }, () => new Set())

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board[r][c]
      if (v !== 0) {
        rowUsed[r].add(v)
        colUsed[c].add(v)
        boxUsed[Math.floor(r / 3) * 3 + Math.floor(c / 3)].add(v)
      }
    }
  }

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== 0) {
        out[r][c] = [board[r][c]]
        continue
      }
      const box = Math.floor(r / 3) * 3 + Math.floor(c / 3)
      for (let v = 1; v <= 9; v++) {
        if (
          !rowUsed[r].has(v) &&
          !colUsed[c].has(v) &&
          !boxUsed[box].has(v)
        ) {
          out[r][c].push(v)
        }
      }
    }
  }
  return out
}

export const EMPTY_SOFT_CONFIG: SoftConfig = {
  rows: [],
  cols: [],
  boxes: [],
  penalize_all: false,
}

/**
 * Axes on which placing ``value`` at ``(r, c)`` would duplicate an existing
 * non-zero entry. The cell itself is ignored so "re-typing" the same value is
 * never flagged. Returns axes in a stable order: rows, cols, boxes.
 */
export function placementConflicts(
  board: Board,
  r: number,
  c: number,
  value: number,
): Axis[] {
  if (value === 0) return []
  const axes: Axis[] = []

  for (let i = 0; i < 9; i++) {
    if (i !== c && board[r][i] === value) {
      axes.push("rows")
      break
    }
  }
  for (let i = 0; i < 9; i++) {
    if (i !== r && board[i][c] === value) {
      axes.push("cols")
      break
    }
  }
  const br = Math.floor(r / 3) * 3
  const bc = Math.floor(c / 3) * 3
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const rr = br + i
      const cc = bc + j
      if ((rr !== r || cc !== c) && board[rr][cc] === value) {
        axes.push("boxes")
        break outer
      }
    }
  }
  return axes
}

/**
 * Split all duplicate cells on the board into clue vs non-clue masks.
 *
 * A cell ``(r, c)`` is "duplicate" if its non-zero value appears more than
 * once on its row, column, or 3x3 box. Cells in ``clueMask`` go into
 * ``clueDup``; everything else (solver-placed) goes into ``nonClueDup``.
 *
 * This is used by penalise-all mode to render user-entered duplicates as
 * rose violations and solver-placed ones as yellow knock-on effects.
 */
export function computeDuplicateMasks(
  board: Board,
  clueMask: boolean[][],
): { clueDup: boolean[][]; nonClueDup: boolean[][] } {
  const clueDup: boolean[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => false),
  )
  const nonClueDup: boolean[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => false),
  )
  const rowCounts: Record<number, number>[] = Array.from({ length: 9 }, () => ({}))
  const colCounts: Record<number, number>[] = Array.from({ length: 9 }, () => ({}))
  const boxCounts: Record<number, number>[] = Array.from({ length: 9 }, () => ({}))
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board[r][c]
      if (!v) continue
      rowCounts[r][v] = (rowCounts[r][v] ?? 0) + 1
      colCounts[c][v] = (colCounts[c][v] ?? 0) + 1
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3)
      boxCounts[b][v] = (boxCounts[b][v] ?? 0) + 1
    }
  }
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board[r][c]
      if (!v) continue
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3)
      const dup =
        (rowCounts[r][v] ?? 0) > 1 ||
        (colCounts[c][v] ?? 0) > 1 ||
        (boxCounts[b][v] ?? 0) > 1
      if (!dup) continue
      if (clueMask[r][c]) clueDup[r][c] = true
      else nonClueDup[r][c] = true
    }
  }
  return { clueDup, nonClueDup }
}

export function hasSoftConfig(cfg: SoftConfig): boolean {
  return (
    cfg.penalize_all ||
    cfg.rows.length + cfg.cols.length + cfg.boxes.length > 0
  )
}

/**
 * Build a 9x9 boolean mask of "violating" cells.
 *
 * * In specific-softening mode a cell with value v is marked when v is
 *   listed as softened for row/column/box and another cell on the same
 *   axis also has value v.
 * * In penalise-all mode every duplicate on any axis is marked, so the
 *   user sees live feedback as they type.
 */
export function computeViolationMask(
  board: Board,
  soft: SoftConfig,
): boolean[][] {
  const mask: boolean[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => false),
  )

  const softRows = new Set(soft.rows)
  const softCols = new Set(soft.cols)
  const softBoxes = new Set(soft.boxes)
  if (
    !soft.penalize_all &&
    softRows.size === 0 &&
    softCols.size === 0 &&
    softBoxes.size === 0
  ) {
    return mask
  }

  const rowCounts: Record<number, number>[] = Array.from({ length: 9 }, () => ({}))
  const colCounts: Record<number, number>[] = Array.from({ length: 9 }, () => ({}))
  const boxCounts: Record<number, number>[] = Array.from({ length: 9 }, () => ({}))

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board[r][c]
      if (!v) continue
      rowCounts[r][v] = (rowCounts[r][v] ?? 0) + 1
      colCounts[c][v] = (colCounts[c][v] ?? 0) + 1
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3)
      boxCounts[b][v] = (boxCounts[b][v] ?? 0) + 1
    }
  }

  const rowSoft = (v: number) => soft.penalize_all || softRows.has(v)
  const colSoft = (v: number) => soft.penalize_all || softCols.has(v)
  const boxSoft = (v: number) => soft.penalize_all || softBoxes.has(v)

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board[r][c]
      if (!v) continue
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3)
      if (rowSoft(v) && (rowCounts[r][v] ?? 0) > 1) mask[r][c] = true
      if (colSoft(v) && (colCounts[c][v] ?? 0) > 1) mask[r][c] = true
      if (boxSoft(v) && (boxCounts[b][v] ?? 0) > 1) mask[r][c] = true
    }
  }
  return mask
}
