"""FastAPI entrypoint for the Canvas teacher-tools backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import assignments, dates, health, late_policy, rename

app = FastAPI(
    title="Canvas Teacher Tools",
    version="0.1.0",
    description=(
        "Minimal async wrapper over the Canvas LMS REST API, exposing "
        "teacher-facing batch operations. Callers pass their Canvas "
        "personal access token as an 'Authorization: Bearer ...' header "
        "on every request; nothing is stored server-side."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health.router)
app.include_router(late_policy.router)
app.include_router(assignments.router)
app.include_router(rename.router)
app.include_router(dates.router)
