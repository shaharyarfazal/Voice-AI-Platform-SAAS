from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import ApiError
from ..models import BusinessSettings


async def load_settings(session: AsyncSession, business_id: uuid.UUID) -> BusinessSettings:
    settings = await session.get(BusinessSettings, business_id)
    if settings is None:
        raise ApiError(
            "not_configured",
            "Online booking isn't set up for this business yet. Offer to take a message instead.",
            status=409,
        )
    return settings
