"""Read-only assignment listing."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..canvas.client import AsyncCanvasClient, CanvasAuthError, CanvasNotFoundError
from ..deps import get_canvas_client
from ..schemas import AssignmentSummary
from ..services.assignments import list_assignments

router = APIRouter(prefix="/api/courses", tags=["assignments"])


@router.get(
    "/{course_id}/assignments",
    response_model=list[AssignmentSummary],
)
async def list_course_assignments(
    course_id: int,
    canvas: AsyncCanvasClient = Depends(get_canvas_client),
) -> list[AssignmentSummary]:
    try:
        return await list_assignments(canvas, course_id)
    except CanvasAuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    except CanvasNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
