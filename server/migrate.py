"""Programmatic Alembic entrypoint: Store() calls this at startup on both backends."""
from pathlib import Path

from alembic import command
from alembic.config import Config

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def _config(url: str) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


def upgrade_to_head(url: str) -> None:
    command.upgrade(_config(url), "head")


def downgrade_to(url: str, revision: str) -> None:
    command.downgrade(_config(url), revision)
