"""Database engines and tenant-scoped sessions.

Two engines share one database: the API engine switches every connection to `sched_app`, which is
subject to row-level security, and the worker engine to `sched_worker`, which bypasses it. Every API
transaction sets `app.business_id`, so a query that forgets its `business_id` filter still can't see
another tenant's rows.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings

_engines: dict[str, AsyncEngine] = {}


def _make_engine(role: str) -> AsyncEngine:
    settings = get_settings()
    # The role is a startup parameter, not a SET ROLE statement: a SET inside the driver's implicit
    # transaction is undone if that transaction rolls back, which would silently leave the connection
    # as the (RLS-exempt) owner. As a startup parameter it's the session default; even RESET ROLE
    # returns to it.
    connect_args = {"server_settings": {"role": role}} if role else {}
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_pool_size,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


def engine(kind: str = "app") -> AsyncEngine:
    if kind not in _engines:
        settings = get_settings()
        _engines[kind] = _make_engine(settings.db_app_role if kind == "app" else settings.db_worker_role)
    return _engines[kind]


async def dispose_engines() -> None:
    for e in list(_engines.values()):
        await e.dispose()
    _engines.clear()


def sessionmaker(kind: str = "app") -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine(kind), expire_on_commit=False)


async def set_tenant(session: AsyncSession, business_id: uuid.UUID) -> None:
    """Scope the current transaction to one business (read by the row-level security policies)."""
    await session.execute(text("SELECT set_config('app.business_id', :bid, true)"), {"bid": str(business_id)})


@asynccontextmanager
async def tenant_session(business_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    """A transaction scoped to one business, committed on success."""
    async with sessionmaker("app")() as session, session.begin():
        await set_tenant(session, business_id)
        yield session


@asynccontextmanager
async def worker_session() -> AsyncIterator[AsyncSession]:
    """A cross-tenant transaction for background jobs."""
    async with sessionmaker("worker")() as session, session.begin():
        yield session
