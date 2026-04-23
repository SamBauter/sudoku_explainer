"""Rename assignments in bulk, streaming progress per assignment.

Rule logic lives on the frontend: the client computes the proposed
names client-side (so preview is instant) and sends an exact list of
``{id, new_name}`` pairs to commit. This service takes that list,
issues one Canvas PUT per pair, and yields a progress event after
each.

Anything where ``new_name`` is empty, identical to the current name,
or longer than Canvas's 255-char cap is filtered out by the frontend;
this service trusts its input.
"""

from __future__ import annotations

from typing import AsyncIterator

from ..canvas.client import AsyncCanvasClient, CanvasError
from ..schemas import RenameEvent, RenameItem


async def stream_renames(
    canvas: AsyncCanvasClient,
    course_id: int,
    renames: list[RenameItem],
) -> AsyncIterator[RenameEvent]:
    total = len(renames)
    yield RenameEvent(kind="start", total=total)

    renamed = 0
    for i, item in enumerate(renames, start=1):
        try:
            await canvas.request(
                "PUT",
                f"/api/v1/courses/{course_id}/assignments/{item.id}",
                data={"assignment[name]": item.new_name},
            )
        except CanvasError as exc:
            yield RenameEvent(
                kind="error",
                index=i,
                assignment_id=item.id,
                error=str(exc),
            )
            continue

        renamed += 1
        yield RenameEvent(
            kind="renamed",
            index=i,
            assignment_id=item.id,
            new_name=item.new_name,
        )

    yield RenameEvent(kind="done", renamed=renamed)
