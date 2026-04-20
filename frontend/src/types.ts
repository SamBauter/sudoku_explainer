export type Board = number[][]
export type Candidates = number[][][]

export type Axis = "rows" | "cols" | "boxes"

export interface SoftConfig {
  rows: number[]
  cols: number[]
  boxes: number[]
  /**
   * When true, the per-axis value lists are ignored and every axis/digit
   * becomes a weight-1 soft constraint. Used by the "penalise all
   * violations" mode where the user types freely and the solver minimises
   * total rule breaks.
   */
  penalize_all: boolean
}

export type SoftMode = "specific" | "penalize_all"

export interface Penalty {
  name: string
  value: number
  weight: number
  axis: "row" | "col" | "box"
  axis_index: number
  digit: number
  kind: "over" | "under"
}

export interface SolveResponse {
  status: "ok" | "infeasible"
  solved: Board | null
  violations: number
  objective: number
  penalties: Penalty[]
}

export interface ExampleResponse {
  board: Board
}
