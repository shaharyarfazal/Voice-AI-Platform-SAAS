from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..context import Actor
from ..models import AuditLog, BookingEvent


def audit(
    session: AsyncSession,
    business_id: uuid.UUID,
    actor: Actor,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    **data: Any,
) -> None:
    session.add(
        AuditLog(
            business_id=business_id,
            actor_type=actor.type,
            actor_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            data=_jsonable(data),
        )
    )


def booking_event(
    session: AsyncSession,
    *,
    business_id: uuid.UUID,
    booking_id: uuid.UUID,
    kind: str,
    actor: Actor,
    from_status: str | None = None,
    to_status: str | None = None,
    **data: Any,
) -> None:
    session.add(
        BookingEvent(
            business_id=business_id,
            booking_id=booking_id,
            kind=kind,
            from_status=from_status,
            to_status=to_status,
            actor_type=actor.type,
            actor_id=actor.id,
            data=_jsonable(data),
        )
    )


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
