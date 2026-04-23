"""Rename-assignments streaming endpoint."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..canvas.client import AsyncCanvasClient, CanvasAuthError, CanvasNotFoundError
from ..deps import get_canvas_client
from ..schemas import RenameRequest
from ..services.rename import stream_renames

router = APIRouter(prefix="/api/courses", tags=["rename"])


@router.post("/{course_id}/rename/stream")
async def rename_assignments_stream(
    course_id: int,
    req: RenameRequest,
    canvas: AsyncCanvasClient = Depends(get_canvas_client),
) -> StreamingResponse:
    async def event_source():
        try:
            async for event in stream_renames(canvas, course_id, req.renames):
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
