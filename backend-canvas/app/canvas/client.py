"""Thin async wrapper around the Canvas LMS REST API.

Centralises three concerns the PyCharm script handled ad hoc:

* Authorization header injection (Bearer token supplied per-request).
* Retry/backoff on 429 and 5xx, honouring ``Retry-After`` when present.
* Link-header pagination, exposed as an ``async`` iterator.

Everything else (endpoint paths, payload shapes) stays at the caller.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

import httpx


class CanvasError(Exception):
    """Base class for Canvas API failures surfaced to the caller."""


class CanvasAuthError(CanvasError):
    """401/403 from Canvas - the caller's token is bad or lacks scope."""


class CanvasNotFoundError(CanvasError):
    """404 from Canvas - resource does not exist or is not visible."""


class CanvasValidationError(CanvasError):
    """4xx from Canvas that isn't auth/not-found (e.g. 400/422).

    Holds the HTTP status code and Canvas's error body so callers can
    surface the detail in per-item progress events without guessing.
    """

    def __init__(self, status_code: int, url: str, body: str) -> None:
        super().__init__(
            f"Canvas {status_code} for {url}: {body[:500]}"
        )
        self.status_code = status_code
        self.body = body


class AsyncCanvasClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = 30.0,
        max_retries: int = 5,
    ) -> None:
        self._max_retries = max_retries
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncCanvasClient":
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.aclose()

    async def request(self, method: str, url: str, **kw: Any) -> httpx.Response:
        """Execute one Canvas request with retry/backoff on 429/5xx."""
        last: httpx.Response | None = None
        for attempt in range(self._max_retries):
            r = await self._http.request(method, url, **kw)
            last = r

            if r.status_code == 429 or 500 <= r.status_code < 600:
                retry_after = _parse_retry_after(r) or min(2 ** attempt, 30)
                await asyncio.sleep(retry_after)
                continue

            if r.status_code in (401, 403):
                raise CanvasAuthError(
                    f"Canvas rejected the token ({r.status_code}). "
                    "Check that the token is valid and the user has access."
                )
            if r.status_code == 404:
                raise CanvasNotFoundError(f"Canvas 404 for {method} {url}")
            if 400 <= r.status_code < 500:
                # Anything else in 4xx (400/422/409/etc.) - Canvas
                # validated and rejected the request. Used to be
                # swallowed as if it succeeded; now surfaced so the
                # dates/rename services can report it per-item instead
                # of claiming success.
                raise CanvasValidationError(r.status_code, url, r.text)

            return r

        assert last is not None
        last.raise_for_status()
        return last

    async def paginate(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict]:
        """Iterate every item across Canvas's Link-header pagination."""
        params = {"per_page": 100, **(params or {})}
        next_url: str | None = url
        first = True
        while next_url:
            r = await self.request(
                "GET", next_url, params=params if first else None
            )
            r.raise_for_status()
            payload = r.json()
            if not isinstance(payload, list):
                raise CanvasError(
                    f"Expected a JSON array from {next_url}, got {type(payload).__name__}"
                )
            for item in payload:
                yield item
            next_url = r.links.get("next", {}).get("url")
            first = False


def _parse_retry_after(r: httpx.Response) -> float | None:
    """Parse a numeric Retry-After header, if Canvas set one."""
    raw = r.headers.get("Retry-After")
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None
