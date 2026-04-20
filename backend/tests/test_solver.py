"""End-to-end sanity tests for the solver and FastAPI app."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.solver import EXAMPLE_BOARD, SoftConfig, solve


EXPECTED_SOLUTION = [
    [5, 3, 4, 6, 7, 8, 9, 1, 2],
    [6, 7, 2, 1, 9, 5, 3, 4, 8],
    [1, 9, 8, 3, 4, 2, 5, 6, 7],
    [8, 5, 9, 7, 6, 1, 4, 2, 3],
    [4, 2, 6, 8, 5, 3, 7, 9, 1],
    [7, 1, 3, 9, 2, 4, 8, 5, 6],
    [9, 6, 1, 5, 3, 7, 2, 8, 4],
    [2, 8, 7, 4, 1, 9, 6, 3, 5],
    [3, 4, 5, 2, 8, 6, 1, 7, 9],
]


def test_solve_matches_published_solution():
    out = solve(EXAMPLE_BOARD)
    assert out.status == "ok"
    assert out.solved == EXPECTED_SOLUTION
    assert out.violations == 0
    assert out.objective == 0.0
    # Hard mode introduces no slack variables at all.
    assert out.penalties == []


def test_solve_infeasible_on_conflicting_clues():
    bad = [row[:] for row in EXAMPLE_BOARD]
    bad[0][2] = 5  # duplicate 5 in row 0
    out = solve(bad)
    assert out.status == "infeasible"
    assert out.solved is None


def test_excluding_unique_solution_is_infeasible():
    out = solve(EXAMPLE_BOARD, excluded=[EXPECTED_SOLUTION])
    assert out.status == "infeasible"
    assert out.solved is None


def test_excluding_yields_alternate_solution_when_multiple_exist():
    relaxed = [row[:] for row in EXAMPLE_BOARD]
    for r in range(3):
        for c in range(9):
            relaxed[r][c] = 0
    out1 = solve(relaxed)
    assert out1.status == "ok" and out1.solved is not None
    out2 = solve(relaxed, excluded=[out1.solved])
    assert out2.status == "ok" and out2.solved is not None
    assert out2.solved != out1.solved


def test_soft_mode_allows_duplicate_in_row_when_configured():
    """Two 5s in row 0 is infeasible in hard mode but feasible in soft mode
    when the row-uniqueness constraint for v=5 is relaxed. Columns 0 and 5
    live in different 3x3 boxes, so the row rule is the only one violated."""
    conflict = [[0] * 9 for _ in range(9)]
    conflict[0][0] = 5
    conflict[0][5] = 5

    hard = solve(conflict)
    assert hard.status == "infeasible"

    soft = solve(conflict, soft=SoftConfig(rows={5}))
    assert soft.status == "ok"
    assert soft.solved is not None
    assert soft.solved[0].count(5) >= 2
    assert soft.violations >= 1
    # Every slack carries axis metadata and a name like ``over_row_5_1``.
    assert soft.penalties, "soft mode should expose slack variables"
    assert any(
        p.axis == "row" and p.digit == 5 and p.kind == "over" and p.value >= 1
        for p in soft.penalties
    )


def test_soft_mode_zero_violations_when_not_needed():
    """If the puzzle is already hard-feasible, the soft objective drives
    total excess to zero."""
    out = solve(
        EXAMPLE_BOARD, soft=SoftConfig(rows={5}, cols={5}, boxes={5})
    )
    assert out.violations == 0
    assert out.objective == 0.0


def test_soft_mode_only_relaxes_selected_axis():
    """Relaxing only rows for v=5 must NOT also allow a column-5 duplicate.

    Cells (0,0) and (5,0) share column 0 but live in different boxes and
    different rows, so only column uniqueness is violated."""
    bad = [[0] * 9 for _ in range(9)]
    bad[0][0] = 5
    bad[5][0] = 5

    # Hard: infeasible.
    assert solve(bad).status == "infeasible"
    # Soft rows={5}: still infeasible because cols uniqueness is hard.
    assert solve(bad, soft=SoftConfig(rows={5})).status == "infeasible"
    # Soft cols={5}: now feasible.
    out = solve(bad, soft=SoftConfig(cols={5}))
    assert out.status == "ok"
    assert out.violations >= 1


def test_api_solve_and_resolve_roundtrip():
    client = TestClient(app)
    ex = client.get("/api/example").json()
    assert ex["board"][0] == EXAMPLE_BOARD[0]

    r = client.post("/api/solve", json={"board": ex["board"]}).json()
    assert r["status"] == "ok"
    assert r["solved"] == EXPECTED_SOLUTION
    assert r["violations"] == 0

    r2 = client.post(
        "/api/solve",
        json={"board": ex["board"], "excluded": [r["solved"]]},
    ).json()
    assert r2["status"] == "infeasible"
    assert r2["solved"] is None


def test_api_soft_mode_roundtrip():
    client = TestClient(app)
    conflict = [[0] * 9 for _ in range(9)]
    conflict[0][0] = 5
    conflict[0][5] = 5

    res = client.post("/api/solve", json={"board": conflict}).json()
    assert res["status"] == "infeasible"

    res = client.post(
        "/api/solve",
        json={"board": conflict, "soft": {"rows": [5]}},
    ).json()
    assert res["status"] == "ok"
    assert res["violations"] >= 1


def test_api_rejects_wrong_shape():
    client = TestClient(app)
    bad = [[0] * 9 for _ in range(8)]
    res = client.post("/api/solve", json={"board": bad})
    assert res.status_code == 422


def test_soft_mode_penalize_all_accepts_arbitrary_input():
    """``penalize_all=True`` lets the solver accept any clue board by making
    every axis/digit a weight-1 soft constraint. A board with multiple
    row-5 duplicates that would be infeasible in hard mode must solve, and
    every slack carries weight 1."""
    conflict = [[0] * 9 for _ in range(9)]
    conflict[0][0] = 5
    conflict[0][4] = 5
    conflict[0][8] = 5

    assert solve(conflict).status == "infeasible"

    out = solve(conflict, soft=SoftConfig(penalize_all=True))
    assert out.status == "ok"
    assert out.solved is not None
    assert out.violations >= 2  # at least the two surplus 5s in row 0
    # Penalise-all means no freebies: every slack we introduce is weight 1.
    assert out.penalties, "penalise-all should expose slack variables"
    assert all(p.weight == 1 for p in out.penalties)
    # Objective sums weighted slacks, so it's positive whenever any fire.
    assert out.objective >= out.violations


def test_api_penalize_all_roundtrip():
    client = TestClient(app)
    conflict = [[0] * 9 for _ in range(9)]
    conflict[0][0] = 5
    conflict[0][4] = 5

    res = client.post(
        "/api/solve",
        json={"board": conflict, "soft": {"penalize_all": True}},
    ).json()
    assert res["status"] == "ok"
    assert res["violations"] >= 1
    assert res["penalties"], "penalties should be populated"
    assert all(p["weight"] == 1 for p in res["penalties"])


def test_api_rejects_soft_config_out_of_range():
    client = TestClient(app)
    empty = [[0] * 9 for _ in range(9)]
    res = client.post(
        "/api/solve",
        json={"board": empty, "soft": {"rows": [0]}},
    )
    assert res.status_code == 422
