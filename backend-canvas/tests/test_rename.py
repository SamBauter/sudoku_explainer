"""Tests for the assignment listing and rename streaming services."""

from __future__ import annotations

import httpx
import pytest
import respx

from app.canvas.client import AsyncCanvasClient
from app.schemas import RenameItem
from app.services.assignments import list_assignments
from app.services.rename import stream_renames

BASE = "https://canvas.example.edu"


@pytest.fixture
async def canvas():
    async with AsyncCanvasClient(BASE, "test-token", max_retries=2) as c:
        yield c


@respx.mock
async def test_list_assignments_flattens_summary(canvas: AsyncCanvasClient):
    respx.get(f"{BASE}/api/v1/courses/9/assignments").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "id": 100,
                    "name": "HW 1",
                    "position": 1,
                    "published": True,
                    "extraneous": "ignored",
                },
                {
                    "id": 101,
                    "name": "HW 2",
                    "position": 2,
                    "published": False,
                },
            ],
        )
    )
    result = await list_assignments(canvas, 9)
    assert [a.id for a in result] == [100, 101]
    assert result[0].name == "HW 1"
    assert result[0].position == 1
    assert result[1].published is False


@respx.mock
async def test_list_assignments_skips_malformed_entries(canvas: AsyncCanvasClient):
    respx.get(f"{BASE}/api/v1/courses/9/assignments").mock(
        return_value=httpx.Response(
            200,
            json=[
                {"id": 100, "name": "ok"},
                {"name": "no id"},                     # dropped
                {"id": "not-a-number", "name": "bad"}, # dropped
                {"id": 102, "name": "ok2"},
            ],
        )
    )
    result = await list_assignments(canvas, 9)
    assert [a.id for a in result] == [100, 102]


@respx.mock
async def test_stream_renames_issues_put_per_item_and_reports_done(
    canvas: AsyncCanvasClient,
):
    put_100 = respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(200, json={})
    )
    put_101 = respx.put(f"{BASE}/api/v1/courses/9/assignments/101").mock(
        return_value=httpx.Response(200, json={})
    )

    events = [
        e
        async for e in stream_renames(
            canvas,
            9,
            [
                RenameItem(id=100, new_name="U2: Types"),
                RenameItem(id=101, new_name="U2: Concat"),
            ],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "renamed", "renamed", "done"]
    assert events[0].total == 2
    assert events[-1].renamed == 2

    # The request bodies are form-urlencoded (Canvas's native format).
    assert put_100.called and put_101.called
    body_100 = put_100.calls[0].request.content.decode()
    assert "assignment%5Bname%5D=U2%3A+Types" in body_100


@respx.mock
async def test_stream_renames_reports_per_item_error_and_continues(
    canvas: AsyncCanvasClient,
):
    respx.put(f"{BASE}/api/v1/courses/9/assignments/100").mock(
        return_value=httpx.Response(403, json={"message": "forbidden"})
    )
    respx.put(f"{BASE}/api/v1/courses/9/assignments/101").mock(
        return_value=httpx.Response(200, json={})
    )

    events = [
        e
        async for e in stream_renames(
            canvas,
            9,
            [
                RenameItem(id=100, new_name="will fail"),
                RenameItem(id=101, new_name="will work"),
            ],
        )
    ]

    kinds = [e.kind for e in events]
    assert kinds == ["start", "error", "renamed", "done"]
    assert events[1].assignment_id == 100
    assert events[-1].renamed == 1
