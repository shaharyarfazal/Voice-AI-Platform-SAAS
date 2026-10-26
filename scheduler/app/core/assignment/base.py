from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from ...models import BusinessSettings, Service, Staff


@dataclass
class Choice:
    staff: Staff
    # Why this person was ranked here; stored on the booking as assignment_reason.
    reason: dict[str, Any]


class Assigner(Protocol):
    mode: str

    async def rank(
        self,
        session: AsyncSession,
        *,
        business_id: uuid.UUID,
        settings: BusinessSettings,
        service: Service,
        start: datetime,
        candidates: list[Staff],
    ) -> list[Choice]:
        """Candidates in the order they should be tried. All of them are free for the slot."""
        ...
