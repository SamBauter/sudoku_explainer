"""Sudoku solver built on PuLP.

Follows the formulation from the PuLP case study
(https://coin-or.github.io/pulp/CaseStudies/a_sudoku_problem.html): 729 binary
decision variables ``choices[v, r, c]``, with row/column/box/cell constraints
plus clue constraints. Variables use 1-indexed rows/cols/values to match the
case study; the public API here is 0-indexed for convenience.

Two modes are supported:

* **Hard mode** (``soft=None`` or empty): the standard Sudoku feasibility
  problem. The solver either returns a completion satisfying every rule or
  reports infeasible.
* **Soft mode**: when any value is listed for a given axis, the ENTIRE axis
  (for all 9 values) becomes a soft constraint with non-negative integer
  over / under slacks and ``sum - over + under == 1``. The objective
  penalises slacks on non-softened values with weight 1 and user-softened
  values with weight 0. This is deliberate: to allow two 5s in a row, the
  solver also needs room to leave some other value out of that row, so every
  value on the affected axis has to be able to flex. The penalty weighting
  means the solver still prefers a valid Sudoku wherever possible and only
  "spends" violations that the user explicitly opted into.

  Cell constraints (exactly one value per cell) and clue constraints are
  always hard.

Candidate (pencil-mark) computation is handled on the client.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Set, Tuple

from pulp import (
    LpBinary,
    LpInteger,
    LpProblem,
    LpStatus,
    LpVariable,
    PULP_CBC_CMD,
    lpSum,
    value as pulp_value,
)

Board = List[List[int]]

VALS = ROWS = COLS = list(range(1, 10))
BOXES: List[List[Tuple[int, int]]] = [
    [(3 * i + k + 1, 3 * j + l + 1) for k in range(3) for l in range(3)]
    for i in range(3)
    for j in range(3)
]


@dataclass(frozen=True)
class SoftConfig:
    """Per-axis sets of values whose uniqueness constraint is relaxed.

    There are two modes:

    * **Specific softening** (``penalize_all=False``): each entry in
      ``rows``/``cols``/``boxes`` lists a value (1..9) whose uniqueness on
      that axis becomes a weight-0 freebie. Digits not listed on an
      already-softened axis get weight-1 over/under slacks. Axes with no
      listed values remain hard constraints. An empty config is hard mode.
    * **Penalise everything** (``penalize_all=True``): every axis × digit
      becomes a soft constraint with weight 1. The per-axis value sets are
      ignored (the whole model is uniformly penalised), so the solver picks
      the assignment that minimises total rule breaks.
    """

    rows: Set[int] = field(default_factory=set)
    cols: Set[int] = field(default_factory=set)
    boxes: Set[int] = field(default_factory=set)
    penalize_all: bool = False

    def is_active(self) -> bool:
        return self.penalize_all or bool(self.rows or self.cols or self.boxes)


@dataclass(frozen=True)
class SlackDescriptor:
    """Metadata attached to every over/under slack variable so the UI can
    render a human-friendly inspector table alongside the raw LP names."""

    var: LpVariable
    weight: int
    axis: str  # "row" | "col" | "box"
    axis_index: int  # 1..9 across all axes
    digit: int  # 1..9
    kind: str  # "over" | "under"


@dataclass(frozen=True)
class PenaltyInfo:
    """JSON-serialisable view of a single slack variable after solve."""

    name: str
    value: int
    weight: int
    axis: str
    axis_index: int
    digit: int
    kind: str


@dataclass(frozen=True)
class SolveOutcome:
    status: str
    solved: Board | None
    violations: int
    objective: float
    penalties: List[PenaltyInfo]


def _new_choices() -> Dict[int, Dict[int, Dict[int, LpVariable]]]:
    return LpVariable.dicts("Choice", (VALS, ROWS, COLS), cat=LpBinary)


def build_model(
    board: Board,
    soft: SoftConfig | None = None,
) -> Tuple[
    LpProblem,
    Dict[int, Dict[int, Dict[int, LpVariable]]],
    List[SlackDescriptor],
]:
    """Build a fresh Sudoku LP for the given clue board.

    Returns ``(prob, choices, slacks)`` where ``slacks`` is every over/under
    variable we introduced for softened axes, tagged with the weight it
    carries in the objective (``0`` for user-softened over/under, ``1`` for
    penalised over/under of non-softened values on the same axis).
    """
    soft = soft or SoftConfig()
    prob = LpProblem("Sudoku")
    choices = _new_choices()

    objective_terms: List[LpVariable] = []
    slacks: List[SlackDescriptor] = []

    for r in ROWS:
        for c in COLS:
            prob += lpSum(choices[v][r][c] for v in VALS) == 1

    axis_defs: List[Tuple[str, Set[int], List[Tuple[int, List[Tuple[int, int]]]]]] = [
        (
            "row",
            soft.rows,
            [(r, [(r, c) for c in COLS]) for r in ROWS],
        ),
        (
            "col",
            soft.cols,
            [(c, [(r, c) for r in ROWS]) for c in COLS],
        ),
        (
            "box",
            soft.boxes,
            [(i + 1, BOXES[i]) for i in range(9)],
        ),
    ]

    for axis_name, soft_values, instances in axis_defs:
        # ``penalize_all`` forces every axis soft even if no digit is listed
        # as a freebie; combined with the weight logic below, that makes
        # every slack weight-1 (no freebies anywhere).
        axis_is_soft = soft.penalize_all or bool(soft_values)
        for idx, cells in instances:
            for v in VALS:
                s = lpSum(choices[v][r][c] for (r, c) in cells)
                if not axis_is_soft:
                    prob += s == 1
                    continue
                over = LpVariable(
                    f"over_{axis_name}_{v}_{idx}", lowBound=0, cat=LpInteger
                )
                under = LpVariable(
                    f"under_{axis_name}_{v}_{idx}", lowBound=0, cat=LpInteger
                )
                prob += s - over + under == 1
                # In penalise-everything mode every slack is weight-1; in
                # specific-softening mode listed values are freebies.
                is_freebie = (not soft.penalize_all) and v in soft_values
                over_weight = 0 if is_freebie else 1
                under_weight = 0 if is_freebie else 1
                slacks.append(
                    SlackDescriptor(
                        var=over,
                        weight=over_weight,
                        axis=axis_name,
                        axis_index=idx,
                        digit=v,
                        kind="over",
                    )
                )
                slacks.append(
                    SlackDescriptor(
                        var=under,
                        weight=under_weight,
                        axis=axis_name,
                        axis_index=idx,
                        digit=v,
                        kind="under",
                    )
                )
                if over_weight:
                    objective_terms.append(over)
                if under_weight:
                    objective_terms.append(under)

    for r0 in range(9):
        for c0 in range(9):
            v = board[r0][c0]
            if v != 0:
                prob += choices[v][r0 + 1][c0 + 1] == 1

    if objective_terms:
        prob += lpSum(objective_terms)

    return prob, choices, slacks


def _add_exclusion(
    prob: LpProblem,
    choices: Dict[int, Dict[int, Dict[int, LpVariable]]],
    solution: Board,
) -> None:
    """Forbid ``solution`` by requiring at least one cell to differ."""
    prob += (
        lpSum(
            choices[solution[r][c]][r + 1][c + 1]
            for r in range(9)
            for c in range(9)
            if solution[r][c] != 0
        )
        <= 80
    )


def _solver():
    return PULP_CBC_CMD(msg=0)


def _extract_solution(
    choices: Dict[int, Dict[int, Dict[int, LpVariable]]],
) -> Board:
    solved: Board = [[0] * 9 for _ in range(9)]
    for r in ROWS:
        for c in COLS:
            for v in VALS:
                if choices[v][r][c].value() == 1:
                    solved[r - 1][c - 1] = v
                    break
    return solved


def _int_value(var: LpVariable) -> int:
    return int(round(pulp_value(var) or 0.0))


def solve(
    board: Board,
    excluded: Sequence[Board] | None = None,
    soft: SoftConfig | None = None,
) -> SolveOutcome:
    """Solve a Sudoku board, optionally excluding known solutions.

    Returns a :class:`SolveOutcome` containing the status, the solved board
    (if any), a ``violations`` count that is the total extra placements
    attributable to the user's soft-constraint choices, the LP objective
    value, and a list of every over / under slack we introduced with its
    weight and post-solve value so the frontend can render an inspector.
    """
    prob, choices, slacks = build_model(board, soft)
    for prev in excluded or ():
        _add_exclusion(prob, choices, prev)
    prob.solve(_solver())
    if LpStatus[prob.status] != "Optimal":
        return SolveOutcome(
            status="infeasible",
            solved=None,
            violations=0,
            objective=0.0,
            penalties=[],
        )

    penalties: List[PenaltyInfo] = []
    violations = 0
    for s in slacks:
        v = _int_value(s.var)
        penalties.append(
            PenaltyInfo(
                name=s.var.name,
                value=v,
                weight=s.weight,
                axis=s.axis,
                axis_index=s.axis_index,
                digit=s.digit,
                kind=s.kind,
            )
        )
        # ``violations`` is the total number of duplicate placements the
        # solver chose (sum of every ``over`` slack). In specific-softening
        # mode that's freebies + knock-on overs; in penalise-all mode it's
        # simply "how many cells broke a uniqueness rule".
        if s.kind == "over":
            violations += v

    objective = pulp_value(prob.objective) if prob.objective is not None else 0.0
    return SolveOutcome(
        status="ok",
        solved=_extract_solution(choices),
        violations=violations,
        objective=float(objective or 0.0),
        penalties=penalties,
    )


EXAMPLE_BOARD: Board = [
    [5, 3, 0, 0, 7, 0, 0, 0, 0],
    [6, 0, 0, 1, 9, 5, 0, 0, 0],
    [0, 9, 8, 0, 0, 0, 0, 6, 0],
    [8, 0, 0, 0, 6, 0, 0, 0, 3],
    [4, 0, 0, 8, 0, 3, 0, 0, 1],
    [7, 0, 0, 0, 2, 0, 0, 0, 6],
    [0, 6, 0, 0, 0, 0, 2, 8, 0],
    [0, 0, 0, 4, 1, 9, 0, 0, 5],
    [0, 0, 0, 0, 8, 0, 0, 7, 9],
]
