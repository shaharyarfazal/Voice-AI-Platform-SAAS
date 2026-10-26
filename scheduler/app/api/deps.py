from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from ..context import RequestContext
from ..db import sessionmaker, set_tenant
from ..errors import ApiError

T = TypeVar("T")
log = structlog.get_logger("scheduler.api")


async def run(ctx: RequestContext, fn: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run `fn` in one transaction scoped to the caller's business, then the after-commit hooks.

    An ApiError rolls the transaction back unless it asks to keep its changes."""
    error: ApiError | None = None
    async with sessionmaker("app")() as session:
        async with session.begin():
            await set_tenant(session, ctx.business_id)
            try:
                result = await fn(session)
            except ApiError as e:
                if not e.keep_changes:
                    raise
                error = e
    for hook in ctx.after_commit:
        try:
            await hook()
        except Exception as e:  # noqa: BLE001
            log.warning("after_commit.failed", error=str(e))
    if error is not None:
        raise error
    return result  # type: ignore[possibly-undefined]
