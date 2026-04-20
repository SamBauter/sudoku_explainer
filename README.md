# Sudoku LP Solver

A full-stack demo that solves 9×9 Sudoku with an integer linear program
(PuLP + CBC) and lets you poke at the LP internals: enumerate alternative
solutions, relax selected uniqueness rules, and inspect every slack
variable the solver introduces.

Built from the [PuLP Sudoku case study](https://coin-or.github.io/pulp/CaseStudies/a_sudoku_problem.html)
and extended with two **soft-constraint modes**, a live **LP inspector**,
and a grid overlay that distinguishes user clues, solver placements,
free violations, and penalised "knock-on" duplicates.

## Division of concerns

- The **LP layer** (PuLP, CBC) handles:
  - full-board solving,
  - "find another solution" via a `<= 80` exclusion constraint,
  - soft-constraint minimisation with per-slack objective weights.
- The **heuristic layer** (TypeScript, client-side) handles:
  - pencil-mark candidates via row/column/box elimination,
  - per-cell masks (violation, freebie, knock-on) used to tint the grid,
  - input validation + toast feedback for blocked placements.

## Layout

```
sudoku_explainer/
  backend/                FastAPI + PuLP + pytest
    app/
      main.py             API routes and CORS
      solver.py           PuLP model, exclusion + soft constraints
      schemas.py          Pydantic request/response
    tests/
    conftest.py
    pyproject.toml, requirements.txt
  frontend/               Vite + React 19 + TS + Tailwind v4 + shadcn/ui
    src/
      App.tsx
      components/         SudokuGrid, SudokuCell, Toolbar,
                          SoftConstraintsPanel, LpInspector, ui/*
      lib/                api client, candidate + mask helpers
      assets/             background image
```

## Running locally

Both servers run from separate terminals.

### 1. Backend (FastAPI, port 8000)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/api/health` → `{"status":"ok"}`.

### 2. Frontend (Vite, port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The client defaults to
`http://localhost:8000` for the API; override with `VITE_API_URL` in a
`frontend/.env` file if the backend runs elsewhere.

### Tests

```bash
cd backend
source .venv/bin/activate
pip install pytest httpx
pytest tests
```

## API

| Method | Path           | Body                                      | Response                                                                                     |
| ------ | -------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/health`  | –                                         | `{ "status": "ok" }`                                                                         |
| GET    | `/api/example` | –                                         | `{ "board": number[9][9] }`                                                                  |
| POST   | `/api/solve`   | `SolveRequest` (see below)                | `{ status, solved, violations, objective, penalties[] }`                                     |

In every board, `0` means "empty". Soft entries must be digits in `1..9`.

```jsonc
// SolveRequest
{
  "board": number[9][9],
  "excluded": board[],        // optional, previously returned solutions
  "soft": {                   // optional; omitted => hard solve
    "rows":  int[],           // digits whose row-uniqueness is soft + free
    "cols":  int[],
    "boxes": int[],
    "penalize_all": boolean   // if true, every axis/digit is soft (weight 1)
  }
}
```

```jsonc
// SolveResponse
{
  "status": "ok" | "infeasible",
  "solved": number[9][9] | null,
  "violations": number,       // sum of objective-weighted `over` slacks
  "objective": number,        // LP objective value
  "penalties": [              // every slack variable that was introduced
    {
      "name": "over_row_1_5",
      "value": 1,
      "weight": 0 | 1,
      "axis": "row" | "col" | "box",
      "axis_index": 1..9,
      "digit": 1..9,
      "kind": "over" | "under"
    }
  ]
}
```

### Exclusion constraint (re-solve)

`excluded` lists previously returned solutions; the solver adds one
exclusion constraint per entry (the "Extra for Experts" trick from the
case study):

```python
prob += lpSum(choices[prev[r][c]][r + 1][c + 1] for r, c in cells) <= 80
```

Every valid 9×9 solution has exactly 81 of those indicators equal to 1,
so forcing the sum to `<= 80` means at least one cell must differ. Chain
several boards in `excluded` to enumerate up to N solutions; when the
solver returns `infeasible` there are no more.

### Soft-constraint formulation

The solver supports two complementary modes.

**1. Soften specific rules** — `soft.rows` / `soft.cols` / `soft.boxes`
list the digits whose uniqueness should be relaxed along that axis.
When **any** digit is listed for an axis, *every* `(value, instance)`
pair on that axis gets rewritten as

```
sum(choices[v][r][c] for c in row) - over + under == 1   (over, under >= 0, int)
```

and the objective becomes `minimise sum(over + under)` — but only slacks
belonging to values the user did **not** soften contribute (weight 1);
the user-selected softened values have weight 0, i.e. "free" to over- or
under-count. Axes with no selected digits stay hard (`== 1`). The
cell-has-exactly-one-value constraint and the clue constraints are
always hard.

Why soften the whole axis when the user only chose one digit? A
mass-balance argument: the 9 cells of a row each hold exactly one
value, so row uniqueness for *every* digit is jointly implied by the
cell constraint plus uniqueness for all nine digits. Allowing two 5s
in a row mathematically requires another digit to be absent. The
shared axis softening is what lets the solver express that tradeoff;
the objective weights guarantee the solver only spends "extra"
placements the user explicitly opted into.

**2. Penalise all violations** — `soft.penalize_all = true` forces every
axis to be soft with **weight 1 on every slack**. The user can type
freely (client-side input blocking is disabled) and each duplicate on
the final board shows up as a visible, penalised violation.

`violations` in the response counts how many weighted slacks were used
(sum of `over` slacks for values that are actually penalised).
`objective` is the raw LP objective value. `penalties` exposes every
slack variable — name, final value, objective weight, and metadata —
so the frontend's LP Inspector can explain *why* the objective is what
it is.

## Frontend interactions

- **Click** a cell (or arrow to it) and press `1`–`9` to set a clue;
  `Backspace` / `Delete` / `0` clears.
- **Click a pencil-mark digit** to set that cell to that value.
  Disabled candidates are greyed out; available ones highlight on
  hover.
- **Load example** loads the Wikipedia puzzle from the PuLP case study.
- **Show / Hide candidates** toggles the pencil-mark overlay.
- **Solve** runs the LP to fill the board; solver output is rendered in
  sky-blue so it's visually separated from the user's clues.
- After a solve, the Solve button becomes **Find next solution**: click
  it to request a completion that differs from every solution you've
  seen so far. Editing any clue clears the accumulated exclusions.
- **Enable soft constraints** reveals a segmented control with two
  modes:
  - *Soften specific rules*: three 1–9 chip strips (Rows, Columns,
    Boxes). Click a digit to toggle soft-uniqueness for that value on
    that axis. Entries that would violate a rule you did *not* soften
    are blocked with an explanatory toast.
  - *Penalise all violations*: hides the chip strips and lets you type
    anything. Every duplicate on the solved board is penalised (weight
    1) and shown on the grid.
- **Grid highlights** (after a soft-mode solve):
  - **Rose** = user-entered duplicate that the solver had to keep
    (a clue in a penalised axis, or a typed duplicate in penalise-all
    mode).
  - **Darker sky with red text** = user duplicate on an axis the user
    *chose* to soften, so it's free (no objective cost).
  - **Yellow** = solver-placed duplicate (a "knock-on effect" of a
    softened constraint).
  - **Yellow ⚠ marker** in the row/column/box gutters = an `under_*`
    slack fired, i.e. the axis is missing that digit; click the
    marker for a sentence explaining which digit is missing and where.
- **LP Inspector** mirrors the grid colours and lists every slack
  variable, its value, weight, and whether it contributes to the
  objective, along with the objective total.
