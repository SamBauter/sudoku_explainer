"""Runtime settings, sourced from environment variables."""

from __future__ import annotations

import json
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CANVAS_", env_file=".env")

    base_url: str = "https://canvas.instructure.com"
    request_timeout_s: float = 30.0
    max_retries: int = 5
    # NoDecode prevents pydantic-settings from JSON-parsing this field
    # before our validator runs, so dashboard-friendly comma-separated
    # values ("a,b") work alongside proper JSON arrays ('["a","b"]').
    allowed_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_allowed_origins(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value


settings = Settings()
