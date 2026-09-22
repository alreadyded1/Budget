"""`pb` admin CLI. Commands land in the phases that need them."""

import typer

from app import __version__
from app.config import get_settings

app = typer.Typer(help="Payday Budget admin CLI", no_args_is_help=True)


@app.command()
def version() -> None:
    """Print the application version."""
    typer.echo(__version__)


@app.command()
def info() -> None:
    """Show the resolved configuration paths."""
    settings = get_settings()
    typer.echo(f"env:       {settings.env}")
    typer.echo(f"data dir:  {settings.data_dir}")
    typer.echo(f"database:  {settings.db_path}")
    typer.echo(f"base url:  {settings.base_url}")


if __name__ == "__main__":
    app()
