"""List Canvas assignments for a course as trimmed summaries."""

from __future__ import annotations

from ..canvas.client import AsyncCanvasClient
from ..schemas import AssignmentSummary


async def list_assignments(
    canvas: AsyncCanvasClient,
    course_id: int,
) -> list[AssignmentSummary]:
    """Return every assignment in a course, flattening Canvas's pagination."""
    out: list[AssignmentSummary] = []
    async for a in canvas.paginate(
        f"/api/v1/courses/{course_id}/assignments",
    ):
        try:
            out.append(
                AssignmentSummary(
                    id=int(a["id"]),
                    name=str(a.get("name") or ""),
                    position=a.get("position"),
                    published=a.get("published"),
                    due_at=a.get("due_at"),
                    unlock_at=a.get("unlock_at"),
                    lock_at=a.get("lock_at"),
                )
            )
        except (KeyError, TypeError, ValueError):
            # Drop anything Canvas returns that doesn't match the
            # shape we require; better to under-report than to crash.
            continue
    return out
