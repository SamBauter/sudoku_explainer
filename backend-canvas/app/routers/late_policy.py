"""Routes for the late-policy clearing tools.

Four endpoints, two per flag (`missing`, `late`):

* ``POST /api/courses/{course_id}/assignments/{aid}/clear-{kind}``
  Synchronous, returns totals when done. Fine for a single assignment.
* ``POST /api/courses/{course_id}/clear-{kind}/stream``
  Server-Sent Events. One JSON event per assignment processed, plus a
  final ``done`` event with totals.

Both endpoints accept ``?dry_run=true`` to scan without mutating.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..canvas.client import AsyncCanvasClient, CanvasAuthError, CanvasNotFoundError
from ..deps import get_canvas_client
from ..schemas import ClearStats, PolicyKind
from ..services.late_policy import (
    clear_flag_for_assignment,
    clear_flag_for_course,
)

router = APIRouter(prefix="/api/courses", tags=["late-policy"])


def _register_single_endpoint(kind: PolicyKind) -> None:
    """Register the synchronous clear endpoint for a given flag kind.

    Factored out so the two flags stay truly parallel - there's no way
    to add divergent behaviour to one without the other, short of
    editing the service.
    """

    @router.post(
        f"/{{course_id}}/assignments/{{assignment_id}}/clear-{kind}",
        response_model=ClearStats,
        name=f"clear_{kind}_single",
    )
    async def _handler(
        course_id: int,
        assignment_id: int,
        dry_run: bool = Query(default=False),
        canvas: AsyncCanvasClient = Depends(get_canvas_client),
    ) -> ClearStats:
        try:
            return await clear_flag_for_assignment(
                canvas,
                course_id,
                assignment_id,
                kind=kind,
                dry_run=dry_run,
            )
        except CanvasAuthError as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
        except CanvasNotFoundError as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


def _register_stream_endpoint(kind: PolicyKind) -> None:
    @router.post(
        f"/{{course_id}}/clear-{kind}/stream",
        name=f"clear_{kind}_stream",
    )
    async def _handler(
        course_id: int,
        dry_run: bool = Query(default=False),
        canvas: AsyncCanvasClient = Depends(get_canvas_client),
    ) -> StreamingResponse:
        async def event_source():
            try:
                async for event in clear_flag_for_course(
                    canvas, course_id, kind=kind, dry_run=dry_run
                ):
                    yield f"data: {event.model_dump_json()}\n\n"
            except (CanvasAuthError, CanvasNotFoundError) as exc:
                payload = {"kind": "assignment_error", "error": str(exc)}
                yield f"data: {json.dumps(payload)}\n\n"

        return StreamingResponse(
            event_source(),
            media_type="text/event-stream",
            headers={
                # Disable proxy buffering so events reach the browser live.
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )


for _kind in ("missing", "late"):
    _register_single_endpoint(_kind)  # type: ignore[arg-type]
    _register_stream_endpoint(_kind)  # type: ignore[arg-type]
