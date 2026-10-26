"""Our engine → the staff member's calendar: write, move or remove the event for a job.

State-driven and idempotent: whatever the operation that triggered it, a push makes the calendar
match the job as it is now (event on the assigned person's bookings calendar while the job is
confirmed or completed, no event otherwise). Retrying or running twice is harmless.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..connectors import ConnectorError, connector_for
from ..connectors.base import EventPayload, EventRef
from ..core.settings import load_settings
from ..models import Booking, ConnectedAccount, Customer, ExternalCalendar, ExternalEventLink, Service, SyncFailure
from ..verticals import get_vertical
from .locks import lock_calendar
from .tokens import access_token

log = structlog.get_logger("scheduler.sync.push")
LIVE_STATUSES = ("confirmed", "completed")


def _address_line(address: dict) -> str | None:
    """'12 Main St, Springfield, 10001', without repeating parts already in the street line (agents
    often send the whole address as one string)."""
    parts: list[str] = []
    for key in ("line1", "line2", "city", "region", "postal_code"):
        value = str(address.get(key) or "").strip()
        if value and not any(value.lower() in p.lower() for p in parts):
            parts.append(value)
    return ", ".join(parts) or None


async def _payload(session: AsyncSession, booking: Booking) -> EventPayload:
    settings = await load_settings(session, booking.business_id)
    service = await session.get(Service, booking.service_id)
    customer = await session.get(Customer, booking.customer_id) if booking.customer_id else None
    vertical = get_vertical(settings.vertical)
    address = booking.service_address or {}
    location = _address_line(address)
    link = f"{get_settings().app_url.rstrip('/')}/schedule/jobs/{booking.id}"
    lines = [
        f"Customer: {customer.name}" if customer else None,
        f"Phone: {customer.phone_e164}" if customer else None,
        f"Address: {location}" if location else None,
        f"Issue: {booking.description}" if booking.description else None,
        "EMERGENCY" if booking.urgency == "emergency" else None,
        f"Confirmation code: {booking.confirmation_code}" if booking.confirmation_code else None,
        "",
        # Transcripts and recordings stay in our system (privacy); the event links to the job.
        f"Job details, call recording and transcript: {link}",
    ]
    return EventPayload(
        booking_id=str(booking.id),
        title=vertical.title_for(service.name if service else "Job", customer.name if customer else "Customer"),
        start=booking.time_range.lower,
        end=booking.time_range.upper,
        location=location,
        description="\n".join(line for line in lines if line is not None),
        timezone=settings.timezone,
    )


async def target_calendar(session: AsyncSession, staff_id: uuid.UUID) -> tuple[ExternalCalendar, ConnectedAccount] | None:
    row = (
        await session.execute(
            select(ExternalCalendar, ConnectedAccount)
            .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
            .where(ExternalCalendar.staff_id == staff_id, ExternalCalendar.write_bookings_here)
        )
    ).first()
    return (row[0], row[1]) if row else None


async def push_booking(session: AsyncSession, booking_id: uuid.UUID) -> str:
    """Bring the calendars in line with the job. Returns what was done (for logs and tests)."""
    booking = await session.get(Booking, booking_id, populate_existing=True)
    if booking is None:
        return "missing"
    links = list((await session.scalars(select(ExternalEventLink).where(ExternalEventLink.booking_id == booking.id))).all())
    target = await target_calendar(session, booking.staff_id) if booking.status in LIVE_STATUSES else None
    done = []

    # Remove the event wherever it no longer belongs (job canceled, or moved to another person).
    for link in links:
        if target is not None and link.external_calendar_id == target[0].id:
            continue
        cal = await session.get(ExternalCalendar, link.external_calendar_id)
        account = await session.get(ConnectedAccount, cal.connected_account_id) if cal else None
        if cal is not None and account is not None:
            await lock_calendar(session, cal.id)
            if account.status == "active":
                token = await access_token(session, account)
                await connector_for(account.provider).delete_event(token, cal.external_calendar_id, EventRef(link.external_event_id, link.etag))
        await session.delete(link)
        done.append("deleted")
    await session.flush()

    if target is None:
        return ",".join(done) or "nothing"
    cal, account = target
    await lock_calendar(session, cal.id)
    token = await access_token(session, account)
    connector = connector_for(account.provider)
    payload = await _payload(session, booking)
    link = next((l for l in links if l.external_calendar_id == cal.id), None)
    if link is None:
        ref = await connector.create_event(token, cal.external_calendar_id, payload)
        link = ExternalEventLink(business_id=booking.business_id, booking_id=booking.id, external_calendar_id=cal.id, external_event_id=ref.external_event_id)
        session.add(link)
        done.append("created")
    else:
        ref = await connector.update_event(token, cal.external_calendar_id, EventRef(link.external_event_id, link.etag), payload)
        done.append("updated")
    link.external_event_id = ref.external_event_id
    link.etag = ref.etag
    link.pushed_start, link.pushed_end = payload.start, payload.end
    link.last_pushed_at = datetime.now(UTC)
    await session.flush()
    await resolve_failures(session, booking.id)
    log.info("booking.pushed", booking_id=str(booking.id), result=",".join(done))
    return ",".join(done)


async def resolve_failures(session: AsyncSession, booking_id: uuid.UUID) -> None:
    await session.execute(
        update(SyncFailure)
        .where(SyncFailure.booking_id == booking_id, SyncFailure.status != "resolved")
        .values(status="resolved", resolved_at=datetime.now(UTC))
    )


async def record_failure(session: AsyncSession, booking_id: uuid.UUID, error: ConnectorError | Exception, attempts: int) -> None:
    """Out of retries: park it in the dead-letter queue, shown on the job with a retry button."""
    booking = await session.get(Booking, booking_id)
    if booking is None:
        return
    target = await target_calendar(session, booking.staff_id)
    existing = await session.scalar(
        select(SyncFailure).where(SyncFailure.booking_id == booking_id, SyncFailure.status != "resolved", SyncFailure.operation == "push_booking")
    )
    message = str(error)[:500] or type(error).__name__
    if existing:
        existing.attempts += attempts
        existing.last_error = message
        existing.status = "dead"
    else:
        session.add(
            SyncFailure(
                business_id=booking.business_id, booking_id=booking_id,
                connected_account_id=target[1].id if target else None, operation="push_booking",
                payload={"booking_id": str(booking_id)}, attempts=attempts, last_error=message,
            )
        )
    await session.flush()
    log.warning("booking.push_failed", booking_id=str(booking_id), error=message, attempts=attempts)
