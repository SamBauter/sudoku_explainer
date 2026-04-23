"""FastAPI dependencies shared across routers."""

from __future__ import annotations

from typing import AsyncIterator

from fastapi import Header, HTTPException, Query, status

from .canvas.client import AsyncCanvasClient
from .config import settings


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header with a Canvas access token.",
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must be 'Bearer <canvas_token>'.",
        )
    return parts[1].strip()


async def get_canvas_client(
    authorization: str | None = Header(default=None),
    canvas_base_url: str | None = Query(
        default=None,
        description=(
            "Optional override of the Canvas host, e.g. "
            "'https://myschool.instructure.com'. Defaults to the backend's "
            "CANVAS_BASE_URL setting."
        ),
    ),
) -> AsyncIterator[AsyncCanvasClient]:
    """Build a per-request Canvas client from the caller's bearer token.

    Yielded as an async generator so FastAPI closes the underlying
    httpx client when the request (or streaming response) completes.
    """
    token = _extract_bearer(authorization)
    client = AsyncCanvasClient(
        base_url=canvas_base_url or settings.base_url,
        token=token,
        timeout=settings.request_timeout_s,
        max_retries=settings.max_retries,
    )
    try:
        yield client
    finally:
        await client.aclose()
