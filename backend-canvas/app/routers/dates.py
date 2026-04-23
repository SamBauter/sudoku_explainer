"""Bulk-date-update streaming endpoint."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..canvas.client import AsyncCanvasClient, CanvasAuthError, CanvasNotFoundError
from ..deps import get_canvas_client
from ..schemas import DateUpdateRequest
from ..services.dates import stream_date_updates

router = APIRouter(prefix="/api/courses", tags=["dates"])


@router.post("/{course_id}/dates/stream")
async def update_assignment_dates_stream(
    course_id: int,
    req: DateUpdateRequest,
    verify: bool = True,
    canvas: AsyncCanvasClient = Depends(get_canvas_client),
) -> StreamingResponse:
    async def event_source():
        try:
            async for event in stream_date_updates(
                canvas, course_id, req.updates, verify=verify
            ):
                yield f"data: {event.model_dump_json()}\n\n"
        except (CanvasAuthError, CanvasNotFoundError) as exc:
            payload = {"kind": "error", "error": str(exc)}
            yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
