"""`pb` admin CLI. Commands land in the phases that need them."""

import typer

from app import __version__
from app.config import get_settings
from app.db import session_scope
from app.errors import AppError
from app.services import auth as auth_service
from app.services import users as users_service

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


@app.command("create-user")
def create_user(
    username: str = typer.Argument(..., help="Login name, case-insensitive and unique"),
    display_name: str = typer.Option("", "--display-name", help="Defaults to the username"),
    password: str = typer.Option(
        ...,
        prompt=True,
        confirmation_prompt=True,
        hide_input=True,
        help="At least 12 characters. Prompted so it stays out of your shell history.",
    ),
) -> None:
    """Create a household member."""
    with session_scope() as db:
        try:
            user = users_service.create_user(db, username, display_name, password)
        except AppError as exc:
            typer.secho(exc.detail, fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from exc
        typer.secho(f"Created user {user.username} (id {user.id}).", fg=typer.colors.GREEN)


@app.command("reset-password")
def reset_password(
    username: str = typer.Argument(..., help="Login name of the user to reset"),
    password: str = typer.Option(
        ..., prompt=True, confirmation_prompt=True, hide_input=True, help="At least 12 characters."
    ),
) -> None:
    """Set a new password and sign the user out everywhere."""
    with session_scope() as db:
        user = auth_service.get_user_by_username(db, username)
        if user is None:
            typer.secho(f"No user named {username}.", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)
        try:
            users_service.set_password(db, user.id, password, revoke_sessions=True)
        except AppError as exc:
            typer.secho(exc.detail, fg=typer.colors.RED, err=True)
            raise typer.Exit(1) from exc
        typer.secho(
            f"Password reset for {user.username}. All sessions ended.", fg=typer.colors.GREEN
        )


@app.command("list-users")
def list_users() -> None:
    """List household members."""
    with session_scope() as db:
        people = users_service.list_users(db)
        if not people:
            typer.echo("No users yet. Create one with: pb create-user <username>")
            return
        typer.echo(f"{'ID':>3}  {'USERNAME':<20} {'DISPLAY NAME':<24} STATUS")
        for user in people:
            status = "active" if user.is_active else "disabled"
            typer.echo(f"{user.id:>3}  {user.username:<20} {user.display_name:<24} {status}")


@app.command("enable-user")
def enable_user(username: str = typer.Argument(..., help="Login name to re-enable")) -> None:
    """Re-enable a disabled household member."""
    with session_scope() as db:
        user = auth_service.get_user_by_username(db, username)
        if user is None:
            typer.secho(f"No user named {username}.", fg=typer.colors.RED, err=True)
            raise typer.Exit(1)
        users_service.set_active(db, user.id, True, acting_user_id=0)
        typer.secho(f"{user.username} is active again.", fg=typer.colors.GREEN)


if __name__ == "__main__":
    app()
