"""FastAPI application factory: JSON API under /api/v1, built SPA on everything else."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.v1 import api_router
from app.config import Settings, get_settings
from app.errors import register_error_handlers


def _mount_spa(app: FastAPI, dist: Path) -> None:
    """Serve frontend/dist with an SPA fallback so deep links load."""
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    index = dist / "index.html"

    @app.get("/{spa_path:path}", include_in_schema=False)
    def spa(spa_path: str) -> FileResponse:
        if spa_path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown API route")
        candidate = (dist / spa_path).resolve()
        if spa_path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(index)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.ensure_dirs()

    app = FastAPI(
        title="Payday Budget",
        version=__version__,
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/api/openapi.json",
    )
    register_error_handlers(app)
    app.include_router(api_router)

    dist = settings.frontend_dist
    if (dist / "index.html").is_file():
        _mount_spa(app, dist)

    return app


app = create_app()
