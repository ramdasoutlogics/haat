"""Alembic runs migrations only when you ask (`make migrate`); the API never touches the schema."""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.config import settings

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)


def sync_url(url: str) -> str:
    """DATABASE_URL is a plain postgresql:// URL (used by asyncpg); Alembic uses the psycopg driver."""
    for prefix in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def run_migrations_offline() -> None:
    """`alembic upgrade head --sql` prints the SQL instead of running it."""
    context.configure(url=sync_url(settings.database_url), target_metadata=None, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(sync_url(settings.database_url), poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=None, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
