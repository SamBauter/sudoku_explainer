"""Pydantic schemas returned to the frontend."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


PolicyKind = Literal["missing", "late"]
"""Which Canvas late-policy flag a request targets."""


class ClearStats(BaseModel):
    """Counts for one run of a clear-flag tool.

    `cleared` is the count of submissions that had the flag cleared
    (or would be cleared, in dry-run mode). `skipped` covers anything
    that matched an early-return guard: not flagged, protected "true
    zero", missing user_id, etc.
    """

    scanned: int = 0
    skipped: int = 0
    cleared: int = 0

    def merged(self, other: "ClearStats") -> "ClearStats":
        return ClearStats(
            scanned=self.scanned + other.scanned,
            skipped=self.skipped + other.skipped,
            cleared=self.cleared + other.cleared,
        )


ProgressEventKind = Literal[
    "start",
    "assignment_done",
    "assignment_error",
    "done",
]


class ProgressEvent(BaseModel):
    """Event pushed over SSE during a course-wide run.

    Fields not relevant to a given `kind` are left unset. The frontend
    should dispatch on `kind`.
    """

    kind: ProgressEventKind
    index: int | None = None
    total_assignments: int | None = None
    assignment_id: int | None = None
    assignment_name: str | None = None
    stats: ClearStats | None = None
    totals: ClearStats | None = None
    error: str | None = None


class ErrorResponse(BaseModel):
    detail: str = Field(..., description="Human-readable error message")


# ---------------------------------------------------------------------------
# Assignment rename tool
# ---------------------------------------------------------------------------


class AssignmentSummary(BaseModel):
    """Minimal assignment shape needed to drive the rename + dates previews.

    ``due_at``, ``unlock_at``, ``lock_at`` are ISO-8601 UTC timestamps as
    Canvas returns them (or ``None`` when unset). The frontend formats
    them for display in the viewer's local timezone.
    """

    id: int
    name: str
    position: int | None = None
    published: bool | None = None
    due_at: str | None = None
    unlock_at: str | None = None
    lock_at: str | None = None


class RenameItem(BaseModel):
    id: int
    new_name: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Canvas caps assignment names at 255 characters.",
    )


class RenameRequest(BaseModel):
    renames: list[RenameItem] = Field(default_factory=list)


RenameEventKind = Literal["start", "renamed", "error", "done"]


class RenameEvent(BaseModel):
    """Event pushed over SSE during a rename run.

    The ``new_name`` field on `renamed` events echoes what the server
    committed, so the frontend can mark the row confidently rather than
    trusting its own local copy.
    """

    kind: RenameEventKind
    index: int | None = None
    total: int | None = None
    assignment_id: int | None = None
    new_name: str | None = None
    error: str | None = None
    renamed: int | None = None


# ---------------------------------------------------------------------------
# Assignment dates tool (due_at / unlock_at / lock_at bulk edit)
# ---------------------------------------------------------------------------


FieldAction = Literal["keep", "set", "clear"]
"""Per-field action on a date update.

``keep`` -> don't touch the field on Canvas.
``set``  -> overwrite with ``value`` (an ISO-8601 UTC timestamp).
``clear`` -> set the field to ``null`` on Canvas.
"""


class FieldUpdate(BaseModel):
    """One field's desired state in a dates update.

    The frontend computes the final ``value`` for every ``set`` (whether
    the teacher chose an absolute date or a shift-by-N-days) so this
    service stays dumb: it just translates ``action``/``value`` into the
    corresponding Canvas assignment PUT payload.
    """

    action: FieldAction = "keep"
    value: str | None = None


class DateUpdateItem(BaseModel):
    id: int
    due_at: FieldUpdate = Field(default_factory=FieldUpdate)
    unlock_at: FieldUpdate = Field(default_factory=FieldUpdate)
    lock_at: FieldUpdate = Field(default_factory=FieldUpdate)


class DateUpdateRequest(BaseModel):
    updates: list[DateUpdateItem] = Field(default_factory=list)


DateUpdateEventKind = Literal["start", "updated", "error", "done"]


class DateUpdateEvent(BaseModel):
    """Event pushed over SSE during a dates update run.

    ``committed`` echoes back the final per-field state the server sent
    to Canvas (``None`` for a ``clear``, the ISO string for a ``set``,
    absent for a ``keep``), so the frontend can mark each row's state
    confidently.
    """

    kind: DateUpdateEventKind
    index: int | None = None
    total: int | None = None
    assignment_id: int | None = None
    committed: dict[str, str | None] | None = None
    error: str | None = None
    updated: int | None = None
