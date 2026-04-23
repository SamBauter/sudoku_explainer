"""Bulk-edit Canvas assignment dates, streaming progress per assignment.

The frontend computes the final per-field state for every assignment
(whether the teacher asked for an absolute "Set to <dt>" or a relative
"Shift by N days") and sends an exact list of ``{id, field_updates}``
entries to commit. This service translates each entry into a single
Canvas ``PUT /api/v1/courses/:cid/assignments/:id`` and yields an
event after each call.

Canvas expects dates as ISO-8601 UTC strings. To clear a field we send
an empty string - the Canvas API treats ``assignment[due_at]=`` as
null in form-urlencoded bodies. (Sending ``null`` in a JSON body works
too, but keeping every call form-encoded lets us match the rename
service's wire shape.)
"""

from __future__ import annotations

from datetime import datetime
from typing import AsyncIterator

from ..canvas.client import AsyncCanvasClient, CanvasError
from ..schemas import DateUpdateEvent, DateUpdateItem, FieldUpdate

# The three Canvas assignment date fields this tool edits, in the
# order the frontend lays them out in the preview.
DATE_FIELDS: tuple[str, ...] = ("due_at", "unlock_at", "lock_at")


def _parse_iso(v: str | None) -> datetime | None:
    """Parse a Canvas-returned timestamp into a timezone-aware datetime.

    Canvas normalises what we send in at least three ways we don't want
    to false-positive on:

    * Trims trailing ``.000`` milliseconds (``02:43:00.000Z`` -> ``02:43:00Z``).
    * Swaps ``Z`` for ``+00:00`` and vice versa.
    * Sometimes emits ``+0000`` (no colon) for historical reasons.

    Comparing parsed ``datetime`` objects - which represent instants in
    time - normalises all of the above in one shot. Two inputs that
    point at the same UTC moment compare equal regardless of spelling.
    """
    if not v:
        return None
    s = v.strip()
    # Python's fromisoformat pre-3.11 doesn't accept the trailing "Z".
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _build_payload(item: DateUpdateItem) -> tuple[dict[str, str], dict[str, str | None]]:
    """Translate an item's per-field actions into a Canvas form payload.

    Returns ``(payload, committed)`` where ``committed`` echoes what
    was actually sent so the frontend can mark each field confidently.
    """
    payload: dict[str, str] = {}
    committed: dict[str, str | None] = {}
    for field in DATE_FIELDS:
        update: FieldUpdate = getattr(item, field)
        if update.action == "keep":
            continue
        if update.action == "clear":
            payload[f"assignment[{field}]"] = ""
            committed[field] = None
            continue
        if update.action == "set" and update.value:
            payload[f"assignment[{field}]"] = update.value
            committed[field] = update.value
    return payload, committed


async def stream_date_updates(
    canvas: AsyncCanvasClient,
    course_id: int,
    updates: list[DateUpdateItem],
    *,
    verify: bool = True,
) -> AsyncIterator[DateUpdateEvent]:
    """Issue one Canvas PUT per item, optionally re-GETting to verify.

    When ``verify`` is True we follow each successful PUT with a GET
    of the same assignment and compare Canvas's returned fields to
    what we intended to commit. If they disagree we downgrade the
    event from ``updated`` to ``error`` with a diagnostic message, so
    the teacher sees it in the live progress stream instead of trusting
    a false-positive success.
    """
    total = len(updates)
    yield DateUpdateEvent(kind="start", total=total)

    updated = 0
    for i, item in enumerate(updates, start=1):
        payload, committed = _build_payload(item)
        if not payload:
            continue

        url = f"/api/v1/courses/{course_id}/assignments/{item.id}"
        try:
            await canvas.request("PUT", url, data=payload)
        except CanvasError as exc:
            yield DateUpdateEvent(
                kind="error",
                index=i,
                assignment_id=item.id,
                error=str(exc),
            )
            continue

        # Verify: read the assignment back and compare the fields we
        # just wrote. Canvas has a handful of quirks (grading-period
        # locks, assignment-override interactions, "fancy midnight"
        # normalisation) that can accept a PUT with 200 while the
        # stored value is different from what we sent. We want those
        # surfaced instead of silently claimed as success.
        if verify:
            try:
                resp = await canvas.request("GET", url)
                got = resp.json()
            except Exception as exc:  # noqa: BLE001 - we report, not raise
                yield DateUpdateEvent(
                    kind="error",
                    index=i,
                    assignment_id=item.id,
                    error=f"PUT succeeded but verify-GET failed: {exc}",
                )
                continue

            mismatches: list[str] = []
            for field, intended in committed.items():
                actual = got.get(field)
                if _parse_iso(actual) != _parse_iso(intended):
                    mismatches.append(
                        f"{field}: sent={intended!r} but Canvas stored={actual!r}"
                    )
            if mismatches:
                yield DateUpdateEvent(
                    kind="error",
                    index=i,
                    assignment_id=item.id,
                    error=(
                        "Canvas accepted the PUT but stored different "
                        "values: " + "; ".join(mismatches)
                    ),
                )
                continue

        updated += 1
        yield DateUpdateEvent(
            kind="updated",
            index=i,
            assignment_id=item.id,
            committed=committed,
        )

    yield DateUpdateEvent(kind="done", updated=updated)
