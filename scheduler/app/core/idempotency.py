"""Idempotent writes for agent retries.

The key row is inserted inside the request's transaction before any work happens. A concurrent retry
with the same key blocks on the primary key until the first transaction finishes, then reads its
stored response — so a retry can never create a second booking.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import ApiError
from ..models import IdempotencyKey


def request_hash(operation: str, payload: dict[str, Any]) -> str:
    body = json.dumps({"op": operation, **payload}, sort_keys=True, default=str)
    return hashlib.sha256(body.encode()).hexdigest()


async def claim(
    session: AsyncSession, business_id: uuid.UUID, key: str, operation: str, payload: dict[str, Any]
) -> dict[str, Any] | None:
    """Claim `key` for this request. Returns the stored response if the key was already used for the
    same request, None if this request should do the work."""
    digest = request_hash(operation, payload)
    inserted = await session.scalar(
        insert(IdempotencyKey)
        .values(business_id=business_id, key=key, operation=operation, request_hash=digest)
        .on_conflict_do_nothing()
        .returning(IdempotencyKey.key)
    )
    if inserted is not None:
        return None
    row = await session.scalar(
        select(IdempotencyKey).where(IdempotencyKey.business_id == business_id, IdempotencyKey.key == key)
    )
    assert row is not None
    if row.operation != operation or row.request_hash != digest:
        raise ApiError(
            "idempotency_mismatch",
            "This idempotency key was already used for a different request.",
            status=409,
        )
    return row.response


async def store(
    session: AsyncSession, business_id: uuid.UUID, key: str, response: dict[str, Any], booking_id: uuid.UUID | None
) -> None:
    await session.execute(
        update(IdempotencyKey)
        .where(IdempotencyKey.business_id == business_id, IdempotencyKey.key == key)
        .values(response=response, booking_id=booking_id)
    )


async def release(session: AsyncSession, business_id: uuid.UUID, key: str) -> None:
    """Forget a key whose request failed, so the caller can retry it."""
    await session.execute(
        delete(IdempotencyKey).where(IdempotencyKey.business_id == business_id, IdempotencyKey.key == key)
    )
