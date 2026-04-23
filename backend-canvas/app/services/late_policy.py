"""Clear Canvas's `missing` / `late` late-policy flags in bulk.

Both tools share the same machinery:

1. Page through every submission on an assignment.
2. Check whether Canvas has flagged the submission with the target
   policy status.
3. Unless the score is exactly 0 (protected "true zero"), clear the
   flag by PUTting ``submission[late_policy_status]=none``.

The `PolicyKind` parameter selects which flag we care about. The
course-wide generator yields `ProgressEvent`s so a router can stream
progress over SSE.

Business rule (shared, chosen by the product owner):
* missing flag + score != 0 -> clear.
* late flag    + score != 0 -> clear.
* score == 0 (a true zero) -> skip.

True zeros are left alone so we don't silently hide legitimate
missing/late records.
"""

from __future__ import annotations

from typing import AsyncIterator

from ..canvas.client import AsyncCanvasClient, CanvasError
from ..schemas import ClearStats, PolicyKind, ProgressEvent


def _is_flagged(sub: dict, kind: PolicyKind) -> bool:
    """Is Canvas currently applying `kind` to this submission?

    Canvas exposes this via two overlapping fields:
    * a boolean ``missing`` / ``late`` (automatic detection), and
    * ``late_policy_status`` (explicit teacher/late-policy override).
    """
    if kind == "missing":
        return (
            sub.get("missing") is True
            or sub.get("late_policy_status") == "missing"
        )
    return (
        sub.get("late") is True
        or sub.get("late_policy_status") == "late"
    )


def _is_true_zero(sub: dict) -> bool:
    return sub.get("score") in (0, 0.0)


async def clear_flag_for_assignment(
    canvas: AsyncCanvasClient,
    course_id: int,
    assignment_id: int,
    *,
    kind: PolicyKind,
    dry_run: bool,
) -> ClearStats:
    stats = ClearStats()

    async for sub in canvas.paginate(
        f"/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions",
    ):
        stats.scanned += 1

        if not _is_flagged(sub, kind) or _is_true_zero(sub):
            stats.skipped += 1
            continue

        user_id = sub.get("user_id")
        if user_id is None:
            stats.skipped += 1
            continue

        if not dry_run:
            await canvas.request(
                "PUT",
                f"/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{int(user_id)}",
                data={"submission[late_policy_status]": "none"},
            )

        stats.cleared += 1

    return stats


async def clear_flag_for_course(
    canvas: AsyncCanvasClient,
    course_id: int,
    *,
    kind: PolicyKind,
    dry_run: bool,
) -> AsyncIterator[ProgressEvent]:
    """Iterate every assignment in a course, yielding a progress event per step."""
    assignments: list[dict] = [
        a async for a in canvas.paginate(f"/api/v1/courses/{course_id}/assignments")
    ]

    yield ProgressEvent(kind="start", total_assignments=len(assignments))

    totals = ClearStats()
    for i, a in enumerate(assignments, start=1):
        aid = int(a["id"])
        try:
            stats = await clear_flag_for_assignment(
                canvas, course_id, aid, kind=kind, dry_run=dry_run
            )
        except CanvasError as exc:
            yield ProgressEvent(
                kind="assignment_error",
                index=i,
                assignment_id=aid,
                assignment_name=a.get("name"),
                error=str(exc),
            )
            continue

        totals = totals.merged(stats)
        yield ProgressEvent(
            kind="assignment_done",
            index=i,
            assignment_id=aid,
            assignment_name=a.get("name"),
            stats=stats,
        )

    yield ProgressEvent(kind="done", totals=totals)
