"""Unit tests for the late-policy clearing service, Canvas mocked via respx."""

from __future__ import annotations

import httpx
import pytest
import respx

from app.canvas.client import AsyncCanvasClient
from app.services.late_policy import (
    clear_flag_for_assignment,
    clear_flag_for_course,
)

BASE = "https://canvas.example.edu"


def _sub(
    user_id: int,
    *,
    missing: bool = False,
    late: bool = False,
    score: float | None = None,
) -> dict:
    """Build a Canvas-shaped submission dict for mocking.

    `late_policy_status` mirrors whichever boolean flag is true to
    stay consistent with what Canvas returns in practice.
    """
    status: str | None = None
    if missing:
        status = "missing"
    elif late:
        status = "late"
    return {
        "user_id": user_id,
        "missing": missing,
        "late": late,
        "late_policy_status": status,
        "score": score,
    }


@pytest.fixture
async def canvas():
    async with AsyncCanvasClient(BASE, "test-token", max_retries=2) as c:
        yield c


@respx.mock
async def test_missing_skips_true_zero_and_non_missing(canvas: AsyncCanvasClient):
    respx.get(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions"
    ).mock(
        return_value=httpx.Response(
            200,
            json=[
                _sub(100, missing=True, score=0),      # true zero -> skip
                _sub(101, missing=False, score=88),    # not missing -> skip
                _sub(102, missing=True, score=75),     # clear this one
                _sub(103, missing=True, score=None),   # clear this one
                _sub(104, late=True, score=75),        # late, not missing -> skip
            ],
        )
    )
    put_102 = respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/102"
    ).mock(return_value=httpx.Response(200, json={}))
    put_103 = respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/103"
    ).mock(return_value=httpx.Response(200, json={}))

    stats = await clear_flag_for_assignment(
        canvas, 1, 10, kind="missing", dry_run=False
    )

    assert stats.scanned == 5
    assert stats.skipped == 3
    assert stats.cleared == 2
    assert put_102.called and put_103.called


@respx.mock
async def test_late_skips_true_zero_and_non_late(canvas: AsyncCanvasClient):
    respx.get(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions"
    ).mock(
        return_value=httpx.Response(
            200,
            json=[
                _sub(200, late=True, score=0),        # true zero -> skip
                _sub(201, late=False, score=88),      # not late -> skip
                _sub(202, late=True, score=75),       # clear this one
                _sub(203, late=True, score=None),     # clear this one (ungraded late)
                _sub(204, missing=True, score=75),    # missing, not late -> skip
            ],
        )
    )
    put_202 = respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/202"
    ).mock(return_value=httpx.Response(200, json={}))
    put_203 = respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/203"
    ).mock(return_value=httpx.Response(200, json={}))

    stats = await clear_flag_for_assignment(
        canvas, 1, 10, kind="late", dry_run=False
    )

    assert stats.scanned == 5
    assert stats.skipped == 3
    assert stats.cleared == 2
    assert put_202.called and put_203.called


@respx.mock
async def test_late_policy_status_string_triggers_kind(canvas: AsyncCanvasClient):
    """A submission whose boolean flag is absent but late_policy_status is
    'late' should still be treated as late."""
    respx.get(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions"
    ).mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "user_id": 300,
                    "missing": False,
                    "late": False,
                    "late_policy_status": "late",
                    "score": 70,
                }
            ],
        )
    )
    respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/300"
    ).mock(return_value=httpx.Response(200, json={}))

    stats = await clear_flag_for_assignment(
        canvas, 1, 10, kind="late", dry_run=False
    )
    assert stats.cleared == 1


@respx.mock
async def test_dry_run_does_not_mutate(canvas: AsyncCanvasClient):
    respx.get(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions"
    ).mock(
        return_value=httpx.Response(
            200,
            json=[_sub(102, late=True, score=75)],
        )
    )
    put_route = respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/102"
    ).mock(return_value=httpx.Response(200, json={}))

    stats = await clear_flag_for_assignment(
        canvas, 1, 10, kind="late", dry_run=True
    )

    assert stats.cleared == 1
    assert not put_route.called


@respx.mock
async def test_follows_link_header_pagination(canvas: AsyncCanvasClient):
    path = f"{BASE}/api/v1/courses/1/assignments/10/submissions"
    page2_url = f"{path}?page=2"

    respx.get(path, params={"page": "2"}).mock(
        return_value=httpx.Response(
            200,
            json=[_sub(101, missing=True, score=60)],
        )
    )
    respx.get(path, params={"per_page": "100"}).mock(
        return_value=httpx.Response(
            200,
            json=[_sub(100, missing=True, score=50)],
            headers={"Link": f'<{page2_url}>; rel="next"'},
        )
    )
    respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/100"
    ).mock(return_value=httpx.Response(200, json={}))
    respx.put(
        f"{BASE}/api/v1/courses/1/assignments/10/submissions/101"
    ).mock(return_value=httpx.Response(200, json={}))

    stats = await clear_flag_for_assignment(
        canvas, 1, 10, kind="missing", dry_run=False
    )

    assert stats.scanned == 2
    assert stats.cleared == 2


@respx.mock
async def test_course_generator_yields_start_per_assignment_and_done(
    canvas: AsyncCanvasClient,
):
    respx.get(f"{BASE}/api/v1/courses/7/assignments").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": 10, "name": "HW 1"},
                {"id": 11, "name": "HW 2"},
            ],
        )
    )
    for aid in (10, 11):
        respx.get(
            f"{BASE}/api/v1/courses/7/assignments/{aid}/submissions"
        ).mock(
            return_value=httpx.Response(
                200,
                json=[_sub(100, late=True, score=75)],
            )
        )
        respx.put(
            f"{BASE}/api/v1/courses/7/assignments/{aid}/submissions/100"
        ).mock(return_value=httpx.Response(200, json={}))

    events = [
        e
        async for e in clear_flag_for_course(
            canvas, 7, kind="late", dry_run=False
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "assignment_done", "assignment_done", "done"]
    assert events[0].total_assignments == 2
    assert events[-1].totals is not None
    assert events[-1].totals.cleared == 2
