from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.ext.asyncio import AsyncSession

from ...models import Booking, BusinessSettings, Service, Staff
from ..timeutil import local_day_bounds, zone
from .base import Choice


async def _counts(
    session: AsyncSession, business_id: uuid.UUID, ids: list[uuid.UUID], start: datetime, end: datetime, now: datetime
) -> dict[uuid.UUID, int]:
    rows = await session.execute(
        select(Booking.staff_id, func.count())
        .where(
            Booking.business_id == business_id,
            Booking.staff_id.in_(ids),
            Booking.time_range.overlaps(Range(start, end, bounds="[)")),
            or_(Booking.status == "confirmed", and_(Booking.status == "held", Booking.hold_expires_at > now)),
        )
        .group_by(Booking.staff_id)
    )
    return {staff_id: count for staff_id, count in rows.all()}


class LeastBusy:
    """Fewest jobs that day, then that week, then higher priority, then name (stable)."""

    mode = "least_busy"

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
        if not candidates:
            return []
        tz = zone(settings.timezone)
        local_day = start.astimezone(tz).date()
        day_start, day_end = local_day_bounds(local_day, tz)
        week_start, _ = local_day_bounds(local_day - timedelta(days=local_day.weekday()), tz)
        _, week_end = local_day_bounds(local_day + timedelta(days=6 - local_day.weekday()), tz)
        ids = [s.id for s in candidates]
        now = datetime.now(start.tzinfo)
        day = await _counts(session, business_id, ids, day_start, day_end, now)
        week = await _counts(session, business_id, ids, week_start, week_end, now)
        ordered = sorted(candidates, key=lambda s: (day.get(s.id, 0), week.get(s.id, 0), -s.priority, s.name, str(s.id)))
        return [
            Choice(
                staff=s,
                reason={
                    "mode": self.mode,
                    "rank": i + 1,
                    "of": len(ordered),
                    "jobs_that_day": day.get(s.id, 0),
                    "jobs_that_week": week.get(s.id, 0),
                    "priority": s.priority,
                },
            )
            for i, s in enumerate(ordered)
        ]
