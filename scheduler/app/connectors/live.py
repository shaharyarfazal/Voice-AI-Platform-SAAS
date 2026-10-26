"""The calls the booking engine makes into the sync layer.

- cached_busy: busy time from the external_busy_blocks cache, for listing slots fast.
- live_busy: ask the provider right now, for the exact interval being confirmed.
- push_booking: write the job's event (enqueued after the booking's transaction commits).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.ext.asyncio import AsyncSession

from .. import metrics
from ..core.intervals import Interval, subtract
from ..models import BusinessSettings, ConnectedAccount, ExternalBusyBlock, ExternalCalendar, ExternalEventLink
from .base import BusyInterval, ConnectorError, connector_for

log = structlog.get_logger("scheduler.connectors")


async def cached_busy(
    session: AsyncSession, business_id: uuid.UUID, staff_ids: list[uuid.UUID], start: datetime, end: datetime
) -> dict[uuid.UUID, list[tuple[datetime, datetime]]]:
    """Busy intervals per staff member from calendars they use for busy time (kept fresh by
    notifications and reconciliation). Events we wrote don't count: the job itself blocks the time."""
    rows = await session.execute(
        select(ExternalBusyBlock.staff_id, ExternalBusyBlock.period)
        .join(ExternalCalendar, ExternalCalendar.id == ExternalBusyBlock.external_calendar_id)
        .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
        .where(
            ExternalBusyBlock.business_id == business_id,
            ExternalBusyBlock.staff_id.in_(staff_ids),
            ExternalBusyBlock.period.overlaps(Range(start, end, bounds="[)")),
            ~ExternalBusyBlock.is_ours,
            ExternalCalendar.use_for_busy,
            ConnectedAccount.status == "active",
        )
    )
    out: dict[uuid.UUID, list[tuple[datetime, datetime]]] = defaultdict(list)
    for staff_id, period in rows.all():
        out[staff_id].append((period.lower, period.upper))
    return out


async def live_busy(
    session: AsyncSession,
    business_id: uuid.UUID,
    staff_id: uuid.UUID,
    start: datetime,
    end: datetime,
    ignore_booking_id: uuid.UUID | None = None,
) -> list[BusyInterval]:
    """Busy time in [start, end) on the staff member's calendars, asked of the provider now (not the
    cache). Called at confirm time. A disconnected account (needs_reauth) makes the person
    unavailable when the business says so; a provider outage falls back to the cache."""
    from ..sync.tokens import access_token

    rows = (
        await session.execute(
            select(ExternalCalendar, ConnectedAccount)
            .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
            .where(ExternalCalendar.business_id == business_id, ExternalCalendar.staff_id == staff_id, ExternalCalendar.use_for_busy)
        )
    ).all()
    if not rows:
        return []
    settings = await session.get(BusinessSettings, business_id)
    by_account: dict[uuid.UUID, tuple[ConnectedAccount, list[str]]] = {}
    for cal, account in rows:
        by_account.setdefault(account.id, (account, []))[1].append(cal.external_calendar_id)

    # Our own event for the job being moved shows as busy at its old time; it mustn't block the move.
    own: list[Interval] = []
    if ignore_booking_id is not None:
        for link in (await session.scalars(select(ExternalEventLink).where(ExternalEventLink.booking_id == ignore_booking_id))).all():
            if link.pushed_start and link.pushed_end:
                own.append((link.pushed_start, link.pushed_end))

    busy: list[BusyInterval] = []
    for account, calendar_ids in by_account.values():
        if account.status != "active":
            if settings is None or settings.unavailable_on_reauth:
                busy.append(BusyInterval(start=start, end=end))
            continue
        try:
            token = await access_token(session, account)
            found = await connector_for(account.provider).get_free_busy(token, calendar_ids, start, end)
        except ConnectorError as e:
            if e.needs_reauth:
                if settings is None or settings.unavailable_on_reauth:
                    busy.append(BusyInterval(start=start, end=end))
                continue
            # Provider down: the cache is the best information we have.
            metrics.LIVE_CHECK_FALLBACK.inc()
            log.warning("live_busy.fallback_to_cache", provider=account.provider, error=str(e))
            cached = await cached_busy(session, business_id, [staff_id], start, end)
            busy += [BusyInterval(start=s, end=e) for s, e in cached.get(staff_id, [])]
            continue
        for interval in found:
            for s, e in subtract([(interval.start, interval.end)], own):
                if s < end and e > start:
                    busy.append(BusyInterval(start=s, end=e))
    return busy

