from __future__ import annotations

import difflib
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import ApiError
from ..models import Service


async def resolve_service(session: AsyncSession, business_id: uuid.UUID, ref: str) -> Service:
    """A service by id or by name, forgiving of how a caller or LLM phrases it ("ac repair", "AC repairs")."""
    services = list(
        (await session.scalars(select(Service).where(Service.business_id == business_id, Service.active))).all()
    )
    ref_clean = ref.strip()
    try:
        wanted = uuid.UUID(ref_clean)
        for s in services:
            if s.id == wanted:
                return s
    except ValueError:
        pass
    needle = ref_clean.lower()
    by_name = {s.name.lower(): s for s in services}
    if needle in by_name:
        return by_name[needle]
    contains = [s for s in services if needle in s.name.lower() or s.name.lower() in needle]
    if len(contains) == 1:
        return contains[0]
    close = difflib.get_close_matches(needle, list(by_name), n=1, cutoff=0.6)
    if close:
        return by_name[close[0]]
    names = ", ".join(s.name for s in services) or "none"
    raise ApiError(
        "unknown_service",
        f"I couldn't match {ref_clean!r} to a service. The services are: {names}.",
        services=[s.name for s in services],
    )
