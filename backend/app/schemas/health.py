"""Schemas for the health endpoint."""

from pydantic import BaseModel


class DatabaseHealth(BaseModel):
    ok: bool
    message: str | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    env: str
    database: DatabaseHealth
