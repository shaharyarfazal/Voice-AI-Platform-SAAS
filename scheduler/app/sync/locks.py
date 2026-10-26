import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_calendar(session: AsyncSession, calendar_id: uuid.UUID) -> None:
    """Serialise sync and writes per external calendar for the rest of the transaction, so a sync
    never sees our own half-finished write (e.g. an event deleted but its link not yet removed)."""
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": f"cal:{calendar_id}"})
