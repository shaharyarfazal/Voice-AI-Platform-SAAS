"""The booking state machine.

    held ──confirm──▶ confirmed ──complete──▶ completed
     │                    │
     ├─expire/release     └─cancel──▶ canceled
     ▼
    expired / released

Rescheduling keeps a booking confirmed and records a `rescheduled` event. Every write that could
double-book a staff member is guarded by the bookings_no_overlap exclusion constraint, so races are
decided by Postgres, not by this code: the loser gets an exclusion violation and tries the next
candidate or reports the slot as taken.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, select, update
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import metrics
from ..connectors import live
from ..context import Actor, RequestContext
from ..errors import ApiError, is_exclusion_violation
from ..models import Booking, BusinessSettings, Service, Staff
from ..verticals import get_vertical
from .assignment import assigner_for
from .audit import audit, booking_event
from .availability import Slot, SlotQuery, candidate_staff, find_slots, free_staff_at
from .customers import find_or_add_address, upsert_customer
from .timeutil import local_day_bounds, zone

log = structlog.get_logger("scheduler.booking")

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: easy to read out on a call


def _ranges(service: Service, start: datetime) -> tuple[Range[datetime], Range[datetime]]:
    end = start + timedelta(minutes=service.duration_min)
    blocked = Range(
        start - timedelta(minutes=service.buffer_before_min),
        end + timedelta(minutes=service.buffer_after_min),
        bounds="[)",
    )
    return Range(start, end, bounds="[)"), blocked


def _query(
    ctx: RequestContext,
    settings: BusinessSettings,
    service: Service,
    start: datetime,
    end: datetime,
    now: datetime,
    *,
    postal_code: str | None = None,
    staff_ids: list[uuid.UUID] | None = None,
    urgency: str = "standard",
    ignore_booking_id: uuid.UUID | None = None,
) -> SlotQuery:
    return SlotQuery(
        business_id=ctx.business_id,
        settings=settings,
        service=service,
        window_start=start,
        window_end=end,
        now=now,
        postal_code=postal_code,
        staff_ids=staff_ids,
        urgency=urgency,
        ignore_booking_id=ignore_booking_id,
    )


async def alternatives(
    session: AsyncSession,
    ctx: RequestContext,
    settings: BusinessSettings,
    service: Service,
    around: datetime,
    now: datetime,
    *,
    postal_code: str | None = None,
    staff_ids: list[uuid.UUID] | None = None,
    urgency: str = "standard",
    exclude: datetime | None = None,
    limit: int = 3,
) -> list[Slot]:
    """The open slots nearest to `around` (same day first, then the next few days), in time order."""
    tz = zone(settings.timezone)
    day_start, _ = local_day_bounds(around.astimezone(tz).date(), tz)
    q = _query(
        ctx, settings, service, day_start, day_start + timedelta(days=4), now,
        postal_code=postal_code, staff_ids=staff_ids, urgency=urgency,
    )
    slots = [s for s in await find_slots(session, q) if s.start != exclude]
    nearest = sorted(slots, key=lambda s: abs((s.start - around).total_seconds()))[:limit]
    return sorted(nearest, key=lambda s: s.start)


async def _expire_stale_holds(
    session: AsyncSession, business_id: uuid.UUID, staff_ids: list[uuid.UUID], blocked: Range[datetime], now: datetime
) -> None:
    """Expired holds still count for the exclusion constraint until something flips them; flip the
    ones in the way now so a lapsed hold never blocks a live caller."""
    rows = await session.execute(
        update(Booking)
        .where(
            Booking.business_id == business_id,
            Booking.status == "held",
            Booking.hold_expires_at <= now,
            Booking.staff_id.in_(staff_ids),
            Booking.blocked_range.overlaps(blocked),
        )
        .values(status="expired", version=Booking.version + 1)
        .returning(Booking.id)
    )
    for (booking_id,) in rows.all():
        booking_event(
            session, business_id=business_id, booking_id=booking_id, kind="expired",
            actor=Actor("system"), from_status="held", to_status="expired",
        )


@dataclass
class Held:
    booking: Booking
    staff: Staff


async def hold(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    settings: BusinessSettings,
    service: Service,
    start: datetime,
    now: datetime,
    source: str,
    postal_code: str | None = None,
    service_address: dict[str, Any] | None = None,
    staff_ids: list[uuid.UUID] | None = None,
    prefer_staff_id: uuid.UUID | None = None,
    urgency: str = "standard",
    respect_hours: bool = True,
    call_id: str | None = None,
) -> Held:
    """Reserve `start` for one free staff member for hold_ttl_sec. Raises ApiError(slot_unavailable)."""
    q = _query(
        ctx, settings, service, start, start + timedelta(minutes=service.duration_min), now,
        postal_code=postal_code, staff_ids=staff_ids, urgency=urgency,
    )
    free = await free_staff_at(session, q, start, respect_hours=respect_hours)
    if not free:
        metrics.HOLDS.labels("unavailable").inc()
        if not await candidate_staff(session, q):
            raise ApiError(
                "no_qualified_staff",
                "Nobody active has the skills for this service in that area. Check the service's required skills.",
                status=409,
            )
        raise ApiError("slot_unavailable", "That time is no longer available.", status=409)

    assigner, fallback = assigner_for(settings.assignment_mode)
    choices = await assigner.rank(
        session, business_id=ctx.business_id, settings=settings, service=service, start=start, candidates=free
    )
    if prefer_staff_id is not None:
        choices.sort(key=lambda c: c.staff.id != prefer_staff_id)
    time_range, blocked = _ranges(service, start)
    await _expire_stale_holds(session, ctx.business_id, [c.staff.id for c in choices], blocked, now)

    for choice in choices:
        reason = {**choice.reason, "candidates": len(choices)}
        if staff_ids is not None:
            # Kept so a lapsed hold is re-held with the same restriction (a requested technician).
            reason["requested_staff_ids"] = [str(i) for i in staff_ids]
        if fallback:
            reason["requested_mode"] = settings.assignment_mode
            reason["note"] = "mode not available yet; used least_busy"
        booking = Booking(
            business_id=ctx.business_id,
            staff_id=choice.staff.id,
            service_id=service.id,
            time_range=time_range,
            blocked_range=blocked,
            status="held",
            hold_expires_at=now + timedelta(seconds=settings.hold_ttl_sec),
            service_address=service_address,
            urgency=urgency,
            source=source,
            call_id=call_id,
            assignment_reason=reason,
        )
        try:
            async with session.begin_nested():
                session.add(booking)
                await session.flush()
        except IntegrityError as e:
            if not is_exclusion_violation(e):
                raise
            # Someone else took this person for an overlapping time a moment ago: try the next one.
            metrics.OVERLAPS_BLOCKED.inc()
            continue
        booking_event(
            session, business_id=ctx.business_id, booking_id=booking.id, kind="held", actor=ctx.actor,
            to_status="held", start=start, staff_id=choice.staff.id, assignment=reason,
        )
        audit(session, ctx.business_id, ctx.actor, "booking.hold", "booking", booking.id, staff_id=choice.staff.id, start=start)
        metrics.HOLDS.labels("held").inc()
        log.info("hold.created", booking_id=str(booking.id), staff_id=str(choice.staff.id), start=start.isoformat())
        return Held(booking=booking, staff=choice.staff)

    metrics.HOLDS.labels("conflict").inc()
    raise ApiError("slot_unavailable", "That time was just taken.", status=409)


async def lock_booking(session: AsyncSession, business_id: uuid.UUID, booking_id: uuid.UUID) -> Booking:
    booking = await session.scalar(
        select(Booking)
        .where(Booking.business_id == business_id, Booking.id == booking_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if booking is None:
        raise ApiError("not_found", "I couldn't find that appointment.", status=404)
    return booking


async def _new_confirmation_code(session: AsyncSession, business_id: uuid.UUID) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        taken = await session.scalar(
            select(Booking.id).where(Booking.business_id == business_id, Booking.confirmation_code == code)
        )
        if taken is None:
            return code
    raise RuntimeError("could not generate a unique confirmation code")


async def _assert_live_free(
    session: AsyncSession, business_id: uuid.UUID, booking: Booking, *, ignore_self: bool = False
) -> None:
    busy = await live.live_busy(
        session, business_id, booking.staff_id, booking.blocked_range.lower, booking.blocked_range.upper,
        ignore_booking_id=booking.id if ignore_self else None,
    )
    if busy:
        raise ApiError("slot_conflict", "That time just became unavailable on the technician's calendar.", status=409)


def _requested_staff(booking: Booking) -> list[uuid.UUID] | None:
    ids = (booking.assignment_reason or {}).get("requested_staff_ids")
    return [uuid.UUID(i) for i in ids] if ids is not None else None


@dataclass
class CustomerInput:
    name: str
    phone_e164: str
    email: str | None
    address: dict[str, Any] | None


async def confirm(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    settings: BusinessSettings,
    booking: Booking,
    customer: CustomerInput,
    now: datetime,
    description: str = "",
    urgency: str | None = None,
    call_id: str | None = None,
    notes: str = "",
    details: dict[str, Any] | None = None,
) -> Booking:
    """Turn a hold (locked by the caller) into a confirmed booking. A lapsed hold is re-held for the
    same time if it's still free. Raises ApiError(hold_expired | slot_conflict)."""
    if booking.status == "confirmed":
        return booking
    service = await session.get(Service, booking.service_id)
    assert service is not None
    start = booking.time_range.lower

    if booking.status == "held" and booking.hold_expires_at is not None and booking.hold_expires_at <= now:
        booking.status = "expired"
        booking.version += 1
        booking_event(
            session, business_id=ctx.business_id, booking_id=booking.id, kind="expired",
            actor=ctx.actor, from_status="held", to_status="expired",
        )
        await session.flush()
    if booking.status == "expired":
        try:
            held = await hold(
                session, ctx, settings=settings, service=service, start=start, now=now, source=booking.source,
                service_address=booking.service_address, prefer_staff_id=booking.staff_id,
                urgency=urgency or booking.urgency, call_id=booking.call_id,
                staff_ids=_requested_staff(booking),
            )
        except ApiError as e:
            raise ApiError("hold_expired", "The hold on that time ran out and the time has been taken.", status=409) from e
        booking = held.booking
    elif booking.status != "held":
        raise ApiError("not_held", f"That appointment can't be confirmed: it is {booking.status}.", status=409)

    # The cache said this time was free; ask the staff member's calendar directly before promising it.
    try:
        await _assert_live_free(session, ctx.business_id, booking)
    except ApiError as e:
        await cancel(session, ctx, booking=booking, reason="busy on external calendar at confirm time")
        e.keep_changes = True
        raise

    vertical = get_vertical(settings.vertical)
    cust = await upsert_customer(
        session, ctx.business_id, name=customer.name, phone_e164=customer.phone_e164, email=customer.email
    )
    address_row = None
    if customer.address and customer.address.get("line1"):
        address_row = await find_or_add_address(session, ctx.business_id, cust.id, customer.address)

    booking.customer_id = cust.id
    booking.address_id = address_row.id if address_row else None
    if customer.address:
        booking.service_address = customer.address
    booking.description = description or booking.description
    booking.urgency = urgency or booking.urgency
    booking.call_id = call_id or booking.call_id
    booking.notes = notes or booking.notes
    booking.details = vertical.validate_details(details)
    booking.status = "confirmed"
    booking.hold_expires_at = None
    booking.confirmation_code = await _new_confirmation_code(session, ctx.business_id)
    booking.version += 1
    await session.flush()

    booking_event(
        session, business_id=ctx.business_id, booking_id=booking.id, kind="confirmed", actor=ctx.actor,
        from_status="held", to_status="confirmed", customer_id=cust.id, call_id=booking.call_id,
    )
    audit(session, ctx.business_id, ctx.actor, "booking.confirm", "booking", booking.id, customer_id=cust.id)
    metrics.BOOKINGS.labels("confirmed", booking.source).inc()
    after_commit_push(ctx, booking.id, "create")
    return booking


async def reschedule(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    settings: BusinessSettings,
    booking: Booking,
    new_start: datetime,
    now: datetime,
    staff_ids: list[uuid.UUID] | None = None,
    respect_hours: bool = True,
    live_check: bool = True,
) -> Booking:
    """Move a confirmed booking (locked by the caller) to `new_start`, keeping the same staff member
    when they're free. One UPDATE moves it, so the old time is never released before the new one is
    secured."""
    if booking.status != "confirmed":
        raise ApiError("not_confirmed", f"Only confirmed appointments can be moved; this one is {booking.status}.", status=409)
    service = await session.get(Service, booking.service_id)
    assert service is not None
    q = _query(
        ctx, settings, service, new_start, new_start + timedelta(minutes=service.duration_min), now,
        staff_ids=staff_ids, urgency=booking.urgency, ignore_booking_id=booking.id,
    )
    free = await free_staff_at(session, q, new_start, respect_hours=respect_hours)
    if not free:
        raise ApiError("slot_unavailable", "That new time isn't available.", status=409)
    assigner, _ = assigner_for(settings.assignment_mode)
    choices = await assigner.rank(
        session, business_id=ctx.business_id, settings=settings, service=service, start=new_start, candidates=free
    )
    choices.sort(key=lambda c: c.staff.id != booking.staff_id)

    old_start, old_staff = booking.time_range.lower, booking.staff_id
    time_range, blocked = _ranges(service, new_start)
    for choice in choices:
        try:
            async with session.begin_nested():
                await session.execute(
                    update(Booking)
                    .where(and_(Booking.id == booking.id, Booking.business_id == ctx.business_id))
                    .values(
                        time_range=time_range, blocked_range=blocked, staff_id=choice.staff.id,
                        version=Booking.version + 1,
                    )
                )
        except IntegrityError as e:
            if not is_exclusion_violation(e):
                raise
            metrics.OVERLAPS_BLOCKED.inc()
            continue
        await session.refresh(booking)
        if live_check:
            await _assert_live_free(session, ctx.business_id, booking, ignore_self=True)
        booking_event(
            session, business_id=ctx.business_id, booking_id=booking.id, kind="rescheduled", actor=ctx.actor,
            from_status="confirmed", to_status="confirmed", from_start=old_start, to_start=new_start,
            from_staff_id=old_staff, to_staff_id=choice.staff.id,
        )
        audit(session, ctx.business_id, ctx.actor, "booking.reschedule", "booking", booking.id, to_start=new_start)
        metrics.BOOKINGS.labels("rescheduled", booking.source).inc()
        after_commit_push(ctx, booking.id, "update")
        return booking
    raise ApiError("slot_unavailable", "That new time was just taken.", status=409)


async def cancel(
    session: AsyncSession, ctx: RequestContext, *, booking: Booking, reason: str | None = None
) -> Booking:
    if booking.status in ("canceled", "released", "expired"):
        return booking
    if booking.status == "completed":
        raise ApiError("already_completed", "That job is already completed.", status=409)
    previous = booking.status
    booking.status = "released" if previous == "held" else "canceled"
    booking.cancel_reason = reason
    booking.hold_expires_at = None
    booking.version += 1
    await session.flush()
    booking_event(
        session, business_id=ctx.business_id, booking_id=booking.id, kind=booking.status, actor=ctx.actor,
        from_status=previous, to_status=booking.status, reason=reason,
    )
    audit(session, ctx.business_id, ctx.actor, f"booking.{booking.status}", "booking", booking.id, reason=reason)
    if previous == "confirmed":
        metrics.BOOKINGS.labels("canceled", booking.source).inc()
        after_commit_push(ctx, booking.id, "delete")
    return booking


async def complete(session: AsyncSession, ctx: RequestContext, *, booking: Booking) -> Booking:
    if booking.status == "completed":
        return booking
    if booking.status != "confirmed":
        raise ApiError("not_confirmed", f"Only confirmed jobs can be completed; this one is {booking.status}.", status=409)
    booking.status = "completed"
    booking.version += 1
    await session.flush()
    booking_event(
        session, business_id=ctx.business_id, booking_id=booking.id, kind="completed", actor=ctx.actor,
        from_status="confirmed", to_status="completed",
    )
    audit(session, ctx.business_id, ctx.actor, "booking.complete", "booking", booking.id)
    return booking


async def expire_holds(session: AsyncSession, now: datetime) -> int:
    """Release every lapsed hold, across all businesses (runs in the worker, outside tenant scope)."""
    rows = (
        await session.execute(
            update(Booking)
            .where(Booking.status == "held", Booking.hold_expires_at <= now)
            .values(status="expired", version=Booking.version + 1)
            .returning(Booking.id, Booking.business_id)
        )
    ).all()
    for booking_id, business_id in rows:
        booking_event(
            session, business_id=business_id, booking_id=booking_id, kind="expired",
            actor=Actor("system"), from_status="held", to_status="expired",
        )
    return len(rows)


def after_commit_push(ctx: RequestContext, booking_id: uuid.UUID, operation: str) -> None:
    from ..worker.queue import enqueue

    async def _push() -> None:
        await enqueue("push_booking", str(ctx.business_id), str(booking_id), operation)

    ctx.after_commit.append(_push)
