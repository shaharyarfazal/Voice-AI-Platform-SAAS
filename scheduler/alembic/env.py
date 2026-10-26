"""Migrations for the `sched` schema. They run as the database's owner (DATABASE_URL), without the
role switch the service uses, because they create roles, extensions and policies."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.models import SCHEMA, Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)


def _configure(connection) -> None:  # noqa: ANN001
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        version_table="alembic_version",
        version_table_schema=SCHEMA,
        include_schemas=True,
        include_name=lambda name, type_, _parent: type_ != "schema" or name == SCHEMA,
    )


def _run(connection) -> None:  # noqa: ANN001
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def _main() -> None:
    engine = create_async_engine(get_settings().database_url)
    async with engine.connect() as connection:
        # The version table lives in the schema, so the schema must exist first.
        await connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        await connection.commit()
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=get_settings().database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(_main())
