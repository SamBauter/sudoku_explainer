# Canvas Teacher Tools — Backend

A small FastAPI service that wraps the [Canvas LMS REST API](https://canvas.instructure.com/doc/api/)
with teacher-facing batch operations. Lives beside `backend/` (the
sudoku LP solver) in the same repo but deploys as its own Render
service because the two have completely different profiles: this one is
async I/O glue, the other is CPU-bound LP.

## v1 scope

Just **clear-missing**. Replicates (and improves) the PyCharm script:
for every missing submission whose score is **not** exactly 0, clear
the missing flag via `submission[late_policy_status]=none`. True zeros
are left alone on purpose.

| Endpoint | Purpose |
| --- | --- |
| `GET  /api/health` | Liveness probe. |
| `POST /api/courses/{course_id}/assignments/{assignment_id}/clear-missing` | Clear missing on a single assignment, return totals. |
| `POST /api/courses/{course_id}/clear-missing/stream` | SSE stream; one event per assignment, final `done` event with totals. |

Both mutating endpoints accept `?dry_run=true` to scan without PUTting.

## Authentication

The teacher supplies their own Canvas personal access token. The
frontend forwards it on every request as

```
Authorization: Bearer <canvas_pat>
```

The token is used immediately and discarded when the request ends.
Nothing is logged or persisted server-side. If/when we add OAuth2 or
LTI 1.3, the swap happens inside `app/deps.py`; routers don't change.

### Optional: per-institution Canvas host

By default the backend uses `CANVAS_BASE_URL` from its env (defaults to
`https://canvas.instructure.com`). A caller can override per-request by
adding `?canvas_base_url=https://myschool.instructure.com` if they need
to target a different host.

## Running locally

```bash
cd backend-canvas
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'        # or: pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

The port is 8001 on purpose so it doesn't clash with the sudoku backend
on 8000. Health check:

```bash
curl http://localhost:8001/api/health
```

## Smoke-testing against a real Canvas

```bash
export CANVAS_TOKEN=...                         # personal access token
export CANVAS_HOST=https://myschool.instructure.com

# Dry run one assignment
curl -X POST \
  -H "Authorization: Bearer $CANVAS_TOKEN" \
  "http://localhost:8001/api/courses/123/assignments/4567/clear-missing?dry_run=true&canvas_base_url=$CANVAS_HOST"

# Stream a whole course (Ctrl-C to stop; -N disables curl buffering)
curl -N -X POST \
  -H "Authorization: Bearer $CANVAS_TOKEN" \
  "http://localhost:8001/api/courses/123/clear-missing/stream?dry_run=true&canvas_base_url=$CANVAS_HOST"
```

## Tests

```bash
cd backend-canvas
source .venv/bin/activate
pip install -e '.[dev]'
pytest
```

Tests use `respx` to mock the Canvas API; no real token required.

## Environment variables

| Name | Default | Meaning |
| --- | --- | --- |
| `CANVAS_BASE_URL` | `https://canvas.instructure.com` | Default Canvas host. |
| `CANVAS_REQUEST_TIMEOUT_S` | `30` | Per-request HTTP timeout. |
| `CANVAS_MAX_RETRIES` | `5` | Retry budget on 429/5xx. |
| `CANVAS_ALLOWED_ORIGINS` | `["http://localhost:5173", ...]` | CORS allow-list; accepts a JSON array. |

All are prefixed with `CANVAS_` because `pydantic-settings` is pointed
at that namespace.

## What's intentionally out of scope for v1

* The two other tools from the original script (tools 1 and 2). Easy to
  add as new routers later — they'll reuse `AsyncCanvasClient` and the
  same auth dep.
* OAuth2 and LTI 1.3. Planned but not needed until multiple teachers
  use the tool.
* Background jobs / durable progress. SSE is stateless and drops on
  reload. If we need resumable runs, add an in-memory job store (and
  eventually Redis on Render) behind a second `/jobs/*` router.
