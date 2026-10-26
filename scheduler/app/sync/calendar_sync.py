"""External calendar → our engine: keep cached busy time current and notice when someone moves or
deletes, in their calendar, an event we wrote for a job."""

from __future__ import annotations

import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range, insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..connectors import ConnectorError, connector_for
from ..connectors.base import BusyInterval, CursorExpired, Subscription
from ..context import Actor, RequestContext
from ..core import booking as engine
from ..core.audit import audit, booking_event
from ..core.settings import load_settings
from ..errors import ApiError
from ..models import Booking, ConnectedAccount, ExternalBusyBlock, ExternalCalendar, ExternalEventLink, SyncState
from .locks import lock_calendar
from .signed import token_hash
from .tokens import access_token

log = structlog.get_logger("scheduler.sync")
# A full re-listing of the window at least this often: rolls the cached window forward (recurring
# events far ahead come into range) and repairs anything a missed notification left behind.
FULL_SYNC_EVERY = timedelta(hours=24)
RENEW_BEFORE = timedelta(hours=24)
SYNC_ACTOR = Actor("system", "calendar-sync")


def webhook_url(provider: str) -> str:
    return f"{get_settings().app_url.rstrip('/')}/api/schedule-webhooks/{provider}"


def synced(cal: ExternalCalendar) -> bool:
    """Busy calendars are synced for availability; the bookings calendar to notice changes to our events."""
    return cal.use_for_busy or cal.write_bookings_here


async def _state(session: AsyncSession, cal: ExternalCalendar) -> SyncState:
    state = await session.get(SyncState, cal.id)
    if state is None:
        state = SyncState(external_calendar_id=cal.id, business_id=cal.business_id)
        session.add(state)
        await session.flush()
    return state


async def sync_calendar(session: AsyncSession, calendar_id: uuid.UUID, *, full: bool = False) -> RequestContext | None:
    """Pull changes for one calendar. Returns a context whose after-commit hooks the caller runs
    (an applied external move schedules a calendar write), or None if nothing was synced."""
    await lock_calendar(session, calendar_id)
    cal = await session.get(ExternalCalendar, calendar_id, populate_existing=True)
    if cal is None or not synced(cal):
        return None
    account = await session.get(ConnectedAccount, cal.connected_account_id)
    if account is None or account.status != "active":
        return None
    state = await _state(session, cal)
    now = datetime.now(UTC)
    window = (now - timedelta(days=1), now + timedelta(days=get_settings().sync_horizon_days))
    if state.last_full_sync_at is None or now - state.last_full_sync_at > FULL_SYNC_EVERY:
        full = True
    connector = connector_for(account.provider)
    business_tz = (await load_settings(session, cal.business_id)).timezone
    try:
        token = await access_token(session, account)
        try:
            changes = await connector.incremental_sync(token, cal.external_calendar_id, None if full else state.cursor, *window, cal.timezone or business_tz)
        except CursorExpired:
            changes = await connector.incremental_sync(token, cal.external_calendar_id, None, *window, cal.timezone or business_tz)
    except ConnectorError as e:
        state.last_error = str(e)[:500]
        state.error_count += 1
        await session.flush()
        raise

    ctx = RequestContext(business_id=cal.business_id, actor=SYNC_ACTOR)
    seen: set[str] = set()
    for interval in changes.upserted:
        assert interval.external_event_id is not None
        seen.add(interval.external_event_id)
        await session.execute(
            insert(ExternalBusyBlock)
            .values(
                business_id=cal.business_id, staff_id=cal.staff_id, external_calendar_id=cal.id,
                external_event_id=interval.external_event_id, period=Range(interval.start, interval.end, bounds="[)"),
                is_ours=interval.is_ours, booking_id=_uuid(interval.booking_id),
            )
            .on_conflict_do_update(
                index_elements=[ExternalBusyBlock.external_calendar_id, ExternalBusyBlock.external_event_id],
                set_={"period": Range(interval.start, interval.end, bounds="[)"), "is_ours": interval.is_ours,
                      "booking_id": _uuid(interval.booking_id), "updated_at": now},
            )
        )
        if interval.is_ours:
            await _check_our_event(session, ctx, cal, account.provider, interval, now)

    gone = set(changes.deleted_event_ids)
    if changes.full:
        known = set((await session.scalars(select(ExternalBusyBlock.external_event_id).where(ExternalBusyBlock.external_calendar_id == cal.id))).all())
        linked = set((await session.scalars(select(ExternalEventLink.external_event_id).where(ExternalEventLink.external_calendar_id == cal.id))).all())
        gone |= (known | linked) - seen
    if gone:
        await session.execute(
            delete(ExternalBusyBlock).where(ExternalBusyBlock.external_calendar_id == cal.id, ExternalBusyBlock.external_event_id.in_(gone))
        )
        for event_id in gone:
            await _check_deleted(session, ctx, cal, account.provider, event_id, now, window)

    state.cursor = changes.next_cursor
    state.last_incremental_at = now
    if changes.full:
        state.last_full_sync_at = now
    state.last_error = None
    state.error_count = 0
    account.last_sync_at = now
    await session.flush()
    log.info("calendar.synced", calendar_id=str(cal.id), full=changes.full, upserted=len(changes.upserted), removed=len(gone))
    return ctx


def _uuid(value: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(value) if value else None
    except ValueError:
        return None


async def _check_our_event(
    session: AsyncSession, ctx: RequestContext, cal: ExternalCalendar, provider: str, interval: BusyInterval, now: datetime
) -> None:
    """One of our events came back from the calendar. Our own writes (same etag, or the times we
    pushed) are echoes; anything else is a change someone made in their calendar."""
    link = await session.scalar(
        select(ExternalEventLink).where(
            ExternalEventLink.external_calendar_id == cal.id, ExternalEventLink.external_event_id == interval.external_event_id
        )
    )
    if link is None:
        return
    if interval.etag and interval.etag == link.etag:
        return
    if (interval.start, interval.end) == (link.pushed_start, link.pushed_end):
        link.etag = interval.etag
        return
    booking = await engine.lock_booking(session, cal.business_id, link.booking_id)
    if booking.status != "confirmed":
        return
    settings = await load_settings(session, cal.business_id)
    old_start, old_end = booking.time_range.lower, booking.time_range.upper
    duration = booking.time_range.upper - booking.time_range.lower
    change = {
        "kind": "moved", "provider": provider, "at": now.isoformat(),
        "from": old_start.isoformat(), "from_end": old_end.isoformat(),
        "to": interval.start.isoformat(), "to_end": interval.end.isoformat(),
    }
    try:
        async with session.begin_nested():
            await engine.reschedule(
                session, ctx, settings=settings, booking=booking, new_start=interval.start, now=now,
                staff_ids=[booking.staff_id], respect_hours=False, live_check=False,
            )
        change["applied"] = True
        if interval.end - interval.start != duration:
            change["note"] = "The calendar event's length was changed; the job keeps its service length."
        link.pushed_start, link.pushed_end = booking.time_range.lower, booking.time_range.upper
        link.etag = interval.etag
    except ApiError as e:
        change["applied"] = False
        change["reason"] = e.message
        await session.refresh(booking)
    booking.external_change = change
    booking.version += 1
    await session.flush()
    booking_event(session, business_id=cal.business_id, booking_id=booking.id, kind="external_change", actor=SYNC_ACTOR, change=change)
    audit(session, cal.business_id, SYNC_ACTOR, "booking.external_change", "booking", booking.id, change=change)


async def _check_deleted(
    session: AsyncSession, ctx: RequestContext, cal: ExternalCalendar, provider: str, event_id: str, now: datetime,
    window: tuple[datetime, datetime],
) -> None:
    link = await session.scalar(
        select(ExternalEventLink).where(ExternalEventLink.external_calendar_id == cal.id, ExternalEventLink.external_event_id == event_id)
    )
    if link is None:
        return
    booking = await session.get(Booking, link.booking_id)
    # Events outside the cached window leave the listing without being deleted.
    if booking is None or booking.status != "confirmed" or not (window[0] < booking.time_range.lower < window[1]):
        return
    change = {"kind": "deleted", "provider": provider, "at": now.isoformat(), "calendar": cal.name}
    booking.external_change = change
    booking.version += 1
    await session.delete(link)
    await session.flush()
    booking_event(session, business_id=cal.business_id, booking_id=booking.id, kind="external_change", actor=SYNC_ACTOR, change=change)
    audit(session, cal.business_id, SYNC_ACTOR, "booking.external_change", "booking", booking.id, change=change)


async def ensure_channel(session: AsyncSession, calendar_id: uuid.UUID) -> None:
    """Make sure change notifications are on for the calendar, renewing a channel that's about to expire."""
    cal = await session.get(ExternalCalendar, calendar_id)
    if cal is None:
        return
    account = await session.get(ConnectedAccount, cal.connected_account_id)
    if account is None or account.status != "active":
        return
    state = await _state(session, cal)
    connector = connector_for(account.provider)
    if not synced(cal):
        if state.channel_id:
            await stop_channel(session, account, state)
        return
    now = datetime.now(UTC)
    if state.channel_id and state.channel_expires_at and state.channel_expires_at - now > RENEW_BEFORE:
        return
    token = await access_token(session, account)
    secret = secrets.token_urlsafe(32)
    if state.channel_id:
        old = Subscription(subscription_id=state.channel_id, resource_id=state.resource_id, expires_at=state.channel_expires_at or now)
        sub = await connector.renew_webhook(token, cal.external_calendar_id, old, webhook_url(account.provider), secret)
    else:
        sub = await connector.subscribe_webhook(token, cal.external_calendar_id, webhook_url(account.provider), secret)
    state.channel_id = sub.subscription_id
    state.resource_id = sub.resource_id
    state.channel_expires_at = sub.expires_at
    state.channel_token_hash = token_hash(secret)
    await session.flush()


async def stop_channel(session: AsyncSession, account: ConnectedAccount, state: SyncState) -> None:
    if not state.channel_id:
        return
    try:
        token = await access_token(session, account)
        await connector_for(account.provider).stop_webhook(
            token, Subscription(subscription_id=state.channel_id, resource_id=state.resource_id, expires_at=datetime.now(UTC))
        )
    except ConnectorError as e:
        # The channel expires by itself; don't block disconnecting on it.
        log.info("channel.stop_failed", error=str(e))
    state.channel_id = None
    state.resource_id = None
    state.channel_expires_at = None
    state.channel_token_hash = None
    await session.flush()


async def calendar_for_channel(session: AsyncSession, channel_id: str, token: str) -> uuid.UUID | None:
    """The calendar a notification is about, if the channel is ours and the token matches."""
    state = await session.scalar(select(SyncState).where(SyncState.channel_id == channel_id))
    if state is None or not state.channel_token_hash or not hmac.compare_digest(state.channel_token_hash, token_hash(token)):
        return None
    return state.external_calendar_id
