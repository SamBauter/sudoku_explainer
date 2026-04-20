"""Pydantic request/response schemas for the Sudoku API."""

from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field, field_validator


Row = List[int]
Board = List[Row]


def _validate_board(board: Board) -> Board:
    if len(board) != 9:
        raise ValueError("board must have 9 rows")
    for r, row in enumerate(board):
        if len(row) != 9:
            raise ValueError(f"row {r} must have 9 columns")
        for c, v in enumerate(row):
            if not isinstance(v, int) or v < 0 or v > 9:
                raise ValueError(f"cell ({r},{c})={v!r} must be an int in 0..9")
    return board


def _validate_value_set(values: List[int], field_name: str) -> List[int]:
    seen = set()
    for v in values:
        if not isinstance(v, int) or v < 1 or v > 9:
            raise ValueError(f"{field_name} entries must be ints in 1..9")
        seen.add(v)
    return sorted(seen)


class SoftConfigSchema(BaseModel):
    """Per-axis lists of values whose uniqueness is relaxed.

    When ``penalize_all`` is true the per-axis lists are ignored and every
    axis/digit becomes a weight-1 soft constraint.
    """

    rows: List[int] = Field(default_factory=list)
    cols: List[int] = Field(default_factory=list)
    boxes: List[int] = Field(default_factory=list)
    penalize_all: bool = False

    @field_validator("rows", "cols", "boxes")
    @classmethod
    def _check_values(cls, v: List[int]) -> List[int]:
        return _validate_value_set(v, "value list")


class SolveRequest(BaseModel):
    board: Board = Field(..., description="9x9 grid; 0 means empty")
    excluded: List[Board] = Field(
        default_factory=list,
        description="Previously returned solutions that must be avoided",
    )
    soft: SoftConfigSchema | None = Field(
        default=None,
        description="If set, per-axis values whose uniqueness is softened",
    )

    @field_validator("board")
    @classmethod
    def _check_board(cls, v: Board) -> Board:
        return _validate_board(v)

    @field_validator("excluded")
    @classmethod
    def _check_excluded(cls, boards: List[Board]) -> List[Board]:
        for b in boards:
            _validate_board(b)
        return boards


class PenaltyInfoSchema(BaseModel):
    """A single slack variable exposed from the LP for the inspector UI."""

    name: str
    value: int
    weight: int
    axis: Literal["row", "col", "box"]
    axis_index: int
    digit: int
    kind: Literal["over", "under"]


class SolveResponse(BaseModel):
    status: Literal["ok", "infeasible"]
    solved: Board | None = None
    violations: int = Field(
        default=0,
        description=(
            "Total count of duplicate placements used (soft mode). "
            "Always 0 in hard mode."
        ),
    )
    objective: float = Field(
        default=0.0,
        description="Value of the LP's objective after solve (0 in hard mode).",
    )
    penalties: List[PenaltyInfoSchema] = Field(
        default_factory=list,
        description=(
            "Every over/under slack variable introduced for softened axes, "
            "with its post-solve value and objective weight."
        ),
    )


class ExampleResponse(BaseModel):
    board: Board
