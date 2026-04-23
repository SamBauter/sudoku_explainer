"""Tests for the assignment dates bulk-update streaming service."""

from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest
import respx

from app.canvas.client import AsyncCanvasClient
from app.schemas import DateUpdateItem, FieldUpdate
from app.services.assignments import list_assignments
from app.services.dates import stream_date_updates

BASE = "https://canvas.example.edu"


@pytest.fixture
async def canvas():
    async with AsyncCanvasClient(BASE, "test-token", max_retries=2) as c:
        yield c


@respx.mock
async def test_list_assignments_passes_through_dates(canvas: AsyncCanvasClient):
    respx.get(f"{BASE}/api/v1/courses/9/assignments").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": 100,
                    "name": "HW 1",
                    "due_at": "2026-05-01T23:59:00Z",
                    "unlock_at": "2026-04-20T07:00:00Z",
                    "lock_at": None,
                },
                {
                    "id": 101,
                    "name": "HW 2",
                    # Canvas omits these keys entirely when unset.
                },
            ],
        )
    )
    result = await list_assignments(canvas, 9)
    assert result[0].due_at == "2026-05-01T23:59:00Z"
    assert result[0].unlock_at == "2026-04-20T07:00:00Z"
    assert result[0].lock_at is None
    assert result[1].due_at is None
    assert result[1].unlock_at is None


@respx.mock
async def test_stream_date_updates_sets_and_clears_fields(canvas: AsyncCanvasClient):
    put_100 = respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(200, json={})
    )
    put_101 = respx.put(f"{BASE}/api/v1/courses/9/assignments/101").mock(
        return_value=httpx.Response(200, json={})
    )
    # Verify-GET mocks: Canvas echoes back the values we intended to
    # write, so both items should flow through as "updated".
    respx.get(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": 100,
                "due_at": "2026-05-08T23:59:00Z",
                "lock_at": None,
                "unlock_at": "2025-01-01T00:00:00Z",
            },
        )
    )
    respx.get(f"{BASE}/api/v1/courses/9/assignments/101").mock(
        return_value=httpx.Response(
            200, json={"id": 101, "due_at": "2026-05-15T23:59:00Z"}
        )
    )

    events = [
        e
        async for e in stream_date_updates(
            canvas,
            9,
            [
                DateUpdateItem(
                    id=100,
                    due_at=FieldUpdate(action="set", value="2026-05-08T23:59:00Z"),
                    unlock_at=FieldUpdate(action="keep"),
                    lock_at=FieldUpdate(action="clear"),
                ),
                DateUpdateItem(
                    id=101,
                    due_at=FieldUpdate(action="set", value="2026-05-15T23:59:00Z"),
                ),
            ],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "updated", "updated", "done"]
    assert events[0].total == 2
    assert events[-1].updated == 2

    body_100 = parse_qs(
        put_100.calls[0].request.content.decode(), keep_blank_values=True
    )
    assert body_100["assignment[due_at]"] == ["2026-05-08T23:59:00Z"]
    assert body_100["assignment[lock_at]"] == [""]
    assert "assignment[unlock_at]" not in body_100

    committed_100 = events[1].committed
    assert committed_100 == {"due_at": "2026-05-08T23:59:00Z", "lock_at": None}

    assert put_101.called


@respx.mock
async def test_stream_date_updates_flags_silent_canvas_drift(
    canvas: AsyncCanvasClient,
):
    """If Canvas accepts the PUT but stores a different value (grading-
    period lock, assignment-override precedence, etc.), the event is
    downgraded from `updated` to `error` so the teacher sees it."""
    respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.get(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": 100,
                # Canvas quietly kept the OLD due_at - stored value
                # disagrees with what we sent.
                "due_at": "2026-01-01T00:00:00Z",
            },
        )
    )

    events = [
        e
        async for e in stream_date_updates(
            canvas,
            9,
            [
                DateUpdateItem(
                    id=100,
                    due_at=FieldUpdate(action="set", value="2026-05-08T23:59:00Z"),
                )
            ],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "error", "done"]
    assert "Canvas accepted the PUT but stored different values" in events[1].error
    assert "2026-05-08T23:59:00Z" in events[1].error
    assert events[-1].updated == 0


@respx.mock
async def test_stream_date_updates_tolerates_equivalent_iso_formatting(
    canvas: AsyncCanvasClient,
):
    """Canvas reformats timestamps in three observed-in-the-wild ways
    that all describe the same instant: swaps ``Z`` for ``+00:00``,
    trims trailing ``.000`` milliseconds, or both. None of these
    should trigger a verify mismatch."""
    respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(200, json={})
    )
    # Sent .000Z millis, Canvas echoes without millis (the real bug
    # reported by the user in testing).
    respx.get(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": 100,
                "due_at": "2026-05-22T02:43:00Z",
                "unlock_at": "2026-05-16T02:43:00+00:00",
                "lock_at": "2026-05-22T02:43:00Z",
            },
        )
    )

    events = [
        e
        async for e in stream_date_updates(
            canvas,
            9,
            [
                DateUpdateItem(
                    id=100,
                    due_at=FieldUpdate(
                        action="set", value="2026-05-22T02:43:00.000Z"
                    ),
                    unlock_at=FieldUpdate(
                        action="set", value="2026-05-16T02:43:00.000Z"
                    ),
                    lock_at=FieldUpdate(
                        action="set", value="2026-05-22T02:43:00.000Z"
                    ),
                )
            ],
        )
    ]

    assert [e.kind for e in events] == ["start", "updated", "done"]


@respx.mock
async def test_stream_date_updates_skips_items_with_all_keep(canvas: AsyncCanvasClient):
    """No-op rows shouldn't cost a Canvas PUT."""
    no_put = respx.put(f"{BASE}/api/v1/courses/9/assignments/100")

    events = [
        e
        async for e in stream_date_updates(
            canvas,
            9,
            [DateUpdateItem(id=100)],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "done"]
    assert events[-1].updated == 0
    assert not no_put.called


@respx.mock
async def test_stream_date_updates_reports_per_item_error_and_continues(
    canvas: AsyncCanvasClient,
):
    respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(403, json={"message": "forbidden"})
    )
    respx.put(f"{BASE}/api/v1/courses/9/assignments/101").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.get(f"{BASE}/api/v1/courses/9/assignments/101").mock(
        return_value=httpx.Response(
            200, json={"id": 101, "due_at": "2026-05-15T23:59:00Z"}
        )
    )

    events = [
        e
        async for e in stream_date_updates(
            canvas,
            9,
            [
                DateUpdateItem(
                    id=100,
                    due_at=FieldUpdate(action="set", value="2026-05-08T23:59:00Z"),
                ),
                DateUpdateItem(
                    id=101,
                    due_at=FieldUpdate(action="set", value="2026-05-15T23:59:00Z"),
                ),
            ],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "error", "updated", "done"]
    assert events[1].assignment_id == 100
    assert events[-1].updated == 1


@respx.mock
async def test_request_raises_on_4xx_validation_error(canvas: AsyncCanvasClient):
    """Used to silently return the response; now surfaces as a
    CanvasValidationError so services can report it per-item instead
    of claiming success."""
    from app.canvas.client import CanvasValidationError

    respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(
            422, json={"errors": {"due_at": ["cannot be in a closed grading period"]}}
        )
    )

    events = [
        e
        async for e in stream_date_updates(
            canvas,
            9,
            [
                DateUpdateItem(
                    id=100,
                    due_at=FieldUpdate(action="set", value="2026-05-08T23:59:00Z"),
                )
            ],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "error", "done"]
    assert "422" in events[1].error
    assert "closed grading period" in events[1].error

    # Also verify the exception type directly so other callers of the
    # client benefit from the same surfacing.
    with pytest.raises(CanvasValidationError):
        await canvas.request(
            "PUT",
            "/api/v1/courses/9/assignments/100",
            data={"assignment[due_at]": "bogus"},
        )
