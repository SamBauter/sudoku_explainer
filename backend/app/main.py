"""FastAPI entrypoint for the Sudoku explainer backend."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    ExampleResponse,
    PenaltyInfoSchema,
    SolveRequest,
    SolveResponse,
)
from .solver import EXAMPLE_BOARD, SoftConfig, solve

app = FastAPI(title="Sudoku Explainer", version="0.3.0")


# Origins allowed to call the API. Local dev hosts are baked in; production
# origins are appended from the SUDOKU_ALLOWED_ORIGINS env var (comma-
# separated) so the Render-assigned frontend URL can be wired in without a
# code change.
_DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_extra = os.environ.get("SUDOKU_ALLOWED_ORIGINS", "")
_extra_origins = [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEFAULT_ORIGINS + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/example", response_model=ExampleResponse)
def example() -> ExampleResponse:
    return ExampleResponse(board=[row[:] for row in EXAMPLE_BOARD])


@app.post("/api/solve", response_model=SolveResponse)
def solve_endpoint(req: SolveRequest) -> SolveResponse:
    soft = None
    if req.soft is not None and (
        req.soft.penalize_all
        or req.soft.rows
        or req.soft.cols
        or req.soft.boxes
    ):
        soft = SoftConfig(
            rows=set(req.soft.rows),
            cols=set(req.soft.cols),
            boxes=set(req.soft.boxes),
            penalize_all=req.soft.penalize_all,
        )
    outcome = solve(req.board, req.excluded, soft)
    return SolveResponse(
        status=outcome.status,
        solved=outcome.solved,
        violations=outcome.violations,
        objective=outcome.objective,
        penalties=[
            PenaltyInfoSchema(
                name=p.name,
                value=p.value,
                weight=p.weight,
                axis=p.axis,
                axis_index=p.axis_index,
                digit=p.digit,
                kind=p.kind,
            )
            for p in outcome.penalties
        ],
    )
