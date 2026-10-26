from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.ext.asyncio import AsyncSession

from ...context import RequestContext
from ...core import booking as engine
from ...core.audit import audit
from ...core.availability import SlotQuery, find_slots
from ...core.customers import normalize_phone
from ...core.service_area import normalize_postal
from ...core.settings import load_settings
from ...core.timeutil import utcnow, zone
from ...errors import ApiError
from ...models import (
    Booking,
    BookingEvent,
    CallArtifact,
    ConnectedAccount,
    Customer,
    CustomerAddress,
    ExternalBusyBlock,
    ExternalCalendar,
    ExternalEventLink,
    Service,
    Staff,
    SyncFailure,
    TimeOff,
)
from ...schemas.dashboard import AvailabilityQuery, BookingCreate, BookingPatch, CancelBody
from ...security.auth import dashboard_context
from ...storage import get_storage
from ...verticals import get_vertical
from ..deps import run
from .serialize import service_out, staff_out

router = APIRouter()

MAX_CALENDAR_DAYS = 62


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@router.get("/calendar")
async def calendar(
    start: datetime,
    end: datetime,
    staff_id: list[uuid.UUID] | None = Query(default=None),
    include_canceled: bool = False,
    ctx: RequestContext = Depends(dashboard_context),
) -> dict[str, Any]:
    """Jobs and time off between `start` and `end` (ISO with offset), for the calendar views."""
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ApiError("invalid_range", "start and end need UTC offsets, and end must be after start.")
    if end - start > timedelta(days=MAX_CALENDAR_DAYS):
        raise ApiError("range_too_long", f"Ask for at most {MAX_CALENDAR_DAYS} days at a time.")

    async def fn(session: AsyncSession) -> dict[str, Any]:
        settings = await load_settings(session, ctx.business_id)
        span = Range(start, end, bounds="[)")
        now = utcnow()
        statuses = ["confirmed", "completed"] + (["canceled"] if include_canceled else [])
        rescheduled = exists().where(BookingEvent.booking_id == Booking.id, BookingEvent.kind == "rescheduled")
        stmt = (
            select(Booking, Customer.name, Customer.phone_e164, Service.name, rescheduled.label("rescheduled"))
            .outerjoin(Customer, Customer.id == Booking.customer_id)
            .join(Service, Service.id == Booking.service_id)
            .where(
                Booking.business_id == ctx.business_id,
                Booking.time_range.overlaps(span),
                or_(Booking.status.in_(statuses), and_(Booking.status == "held", Booking.hold_expires_at > now)),
            )
        )
        if staff_id:
            stmt = stmt.where(Booking.staff_id.in_(staff_id))
        events: list[dict[str, Any]] = []
        for b, customer_name, phone, service_name, was_rescheduled in (await session.execute(stmt)).all():
            events.append(
                {
                    "id": str(b.id),
                    "kind": "booking",
                    "staff_id": str(b.staff_id),
                    "start": b.time_range.lower.isoformat(),
                    "end": b.time_range.upper.isoformat(),
                    "blocked_start": b.blocked_range.lower.isoformat(),
                    "blocked_end": b.blocked_range.upper.isoformat(),
                    "status": b.status,
                    "urgency": b.urgency,
                    "title": customer_name or "Held",
                    "customer_name": customer_name,
                    "customer_phone": phone,
                    "service_name": service_name,
                    "address": (b.service_address or {}).get("line1"),
                    "rescheduled": bool(was_rescheduled),
                    "external_change": b.external_change is not None,
                    "version": b.version,
                }
            )
        off_stmt = select(TimeOff).where(TimeOff.business_id == ctx.business_id, TimeOff.period.overlaps(span))
        if staff_id:
            off_stmt = off_stmt.where(TimeOff.staff_id.in_(staff_id))
        for t in (await session.scalars(off_stmt)).all():
            events.append(
                {
                    "id": str(t.id),
                    "kind": "time_off",
                    "staff_id": str(t.staff_id),
                    "start": t.period.lower.isoformat(),
                    "end": t.period.upper.isoformat(),
                    "title": t.reason or "Time off",
                }
            )
        # Busy time from connected calendars (titles are never stored: just "Busy").
        busy_stmt = (
            select(ExternalBusyBlock, ConnectedAccount.provider)
            .join(ExternalCalendar, ExternalCalendar.id == ExternalBusyBlock.external_calendar_id)
            .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
            .where(
                ExternalBusyBlock.business_id == ctx.business_id, ExternalBusyBlock.period.overlaps(span),
                ~ExternalBusyBlock.is_ours, ExternalCalendar.use_for_busy,
            )
        )
        if staff_id:
            busy_stmt = busy_stmt.where(ExternalBusyBlock.staff_id.in_(staff_id))
        for block, provider in (await session.execute(busy_stmt)).all():
            events.append(
                {
                    "id": str(block.id),
                    "kind": "busy",
                    "staff_id": str(block.staff_id),
                    "start": block.period.lower.isoformat(),
                    "end": block.period.upper.isoformat(),
                    "title": f"Busy ({'Google' if provider == 'google' else 'Outlook' if provider == 'microsoft' else provider})",
                }
            )
        staff = (await session.scalars(select(Staff).where(Staff.business_id == ctx.business_id).order_by(Staff.name))).all()
        return {
            "timezone": settings.timezone,
            "slot_granularity_min": settings.slot_granularity_min,
            "staff": [staff_out(s) for s in staff],
            "events": sorted(events, key=lambda e: e["start"]),
        }

    return await run(ctx, fn)


async def _detail(session: AsyncSession, ctx: RequestContext, booking_id: uuid.UUID) -> dict[str, Any]:
    b = await session.scalar(select(Booking).where(Booking.business_id == ctx.business_id, Booking.id == booking_id))
    if b is None:
        raise ApiError("not_found", "No such booking.", status=404)
    settings = await load_settings(session, ctx.business_id)
    staff = await session.get(Staff, b.staff_id)
    service = await session.get(Service, b.service_id)
    customer = await session.get(Customer, b.customer_id) if b.customer_id else None
    address = await session.get(CustomerAddress, b.address_id) if b.address_id else None
    events = (
        await session.scalars(select(BookingEvent).where(BookingEvent.booking_id == b.id).order_by(BookingEvent.at, BookingEvent.id))
    ).all()
    artifact = None
    if b.call_id:
        artifact = await session.scalar(
            select(CallArtifact).where(CallArtifact.business_id == ctx.business_id, CallArtifact.call_id == b.call_id)
        )
    links = (
        await session.execute(
            select(ExternalEventLink, ExternalCalendar.name, ConnectedAccount.provider, ConnectedAccount.external_email)
            .join(ExternalCalendar, ExternalCalendar.id == ExternalEventLink.external_calendar_id)
            .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
            .where(ExternalEventLink.booking_id == b.id)
        )
    ).all()
    failures = (
        await session.scalars(select(SyncFailure).where(SyncFailure.booking_id == b.id, SyncFailure.status != "resolved"))
    ).all()
    recording_url = None
    if artifact is not None:
        recording_url = get_storage().signed_url(artifact.recording_key) if artifact.recording_key else artifact.recording_url
    return {
        "id": str(b.id),
        "status": b.status,
        "version": b.version,
        "start": b.time_range.lower.isoformat(),
        "end": b.time_range.upper.isoformat(),
        "blocked_start": b.blocked_range.lower.isoformat(),
        "blocked_end": b.blocked_range.upper.isoformat(),
        "hold_expires_at": _iso(b.hold_expires_at),
        "timezone": settings.timezone,
        "confirmation_code": b.confirmation_code,
        "urgency": b.urgency,
        "source": b.source,
        "description": b.description,
        "notes": b.notes,
        "details": b.details,
        "details_schema": get_vertical(settings.vertical).details_model.model_json_schema(),
        "service_address": b.service_address,
        "address": (
            {k: getattr(address, k) for k in ("line1", "line2", "city", "region", "postal_code", "country")}
            if address
            else None
        ),
        "call_id": b.call_id,
        "assignment_reason": b.assignment_reason,
        "external_change": b.external_change,
        "cancel_reason": b.cancel_reason,
        "created_at": b.created_at.isoformat(),
        "updated_at": b.updated_at.isoformat(),
        "staff": staff_out(staff) if staff else None,
        "service": service_out(service) if service else None,
        "customer": (
            {"id": str(customer.id), "name": customer.name, "phone": customer.phone_e164, "email": customer.email}
            if customer
            else None
        ),
        "history": [
            {
                "kind": e.kind,
                "from_status": e.from_status,
                "to_status": e.to_status,
                "actor_type": e.actor_type,
                "actor_id": e.actor_id,
                "data": e.data,
                "at": e.at.isoformat(),
            }
            for e in events
        ],
        "call_artifacts": (
            {
                "recording_url": recording_url,
                "transcript": artifact.transcript,
                "transcript_segments": artifact.transcript_segments,
                "summary": artifact.summary,
            }
            if artifact
            else None
        ),
        "sync": [
            {"provider": provider, "account": email, "calendar": name, "event_id": link.external_event_id,
             "last_pushed_at": link.last_pushed_at.isoformat()}
            for link, name, provider, email in links
        ],
        "sync_failures": [
            {"id": str(f.id), "status": f.status, "attempts": f.attempts, "last_error": f.last_error, "updated_at": f.updated_at.isoformat()}
            for f in failures
        ],
    }


@router.get("/bookings/{booking_id}")
async def get_booking(booking_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        detail = await _detail(session, ctx, booking_id)
        # Job records hold customer data and call recordings: every view is audited.
        audit(session, ctx.business_id, ctx.actor, "booking.view", "booking", booking_id)
        return detail

    return await run(ctx, fn)


@router.post("/bookings", status_code=201)
async def create_booking(body: BookingCreate, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    """Book directly from the dashboard: hold and confirm in one transaction, through the same engine
    the agent uses."""

    async def fn(session: AsyncSession) -> dict[str, Any]:
        settings = await load_settings(session, ctx.business_id)
        service = await session.scalar(select(Service).where(Service.business_id == ctx.business_id, Service.id == body.service_id))
        if service is None:
            raise ApiError("not_found", "No such service.", status=404)
        now = utcnow()
        address = body.address.model_dump(exclude_none=True) if body.address else None
        if address and address.get("postal_code"):
            address["postal_code"] = normalize_postal(address["postal_code"])
        held = await engine.hold(
            session, ctx, settings=settings, service=service, start=body.start, now=now, source="dashboard",
            postal_code=(address or {}).get("postal_code"), service_address=address,
            staff_ids=[body.staff_id] if body.staff_id else None, urgency=body.urgency,
            respect_hours=not body.override_rules,
        )
        booking = await engine.confirm(
            session, ctx, settings=settings, booking=held.booking, now=now,
            customer=engine.CustomerInput(
                name=body.customer.name, phone_e164=normalize_phone(body.customer.phone),
                email=body.customer.email, address=address,
            ),
            description=body.description, urgency=body.urgency, notes=body.notes, details=body.details,
        )
        return await _detail(session, ctx, booking.id)

    return await run(ctx, fn)


@router.patch("/bookings/{booking_id}")
async def update_booking(booking_id: uuid.UUID, body: BookingPatch, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    """Edit, move (drag and drop) or reassign a booking. `version` guards against overwriting a change
    made in the meantime."""

    async def fn(session: AsyncSession) -> dict[str, Any]:
        settings = await load_settings(session, ctx.business_id)
        b = await engine.lock_booking(session, ctx.business_id, booking_id)
        if b.version != body.version:
            raise ApiError("version_conflict", "This job changed since you loaded it. Refresh and try again.", status=409)
        now = utcnow()
        moving = (body.start is not None and body.start != b.time_range.lower) or (
            body.staff_id is not None and body.staff_id != b.staff_id
        )
        if moving:
            b = await engine.reschedule(
                session, ctx, settings=settings, booking=b, new_start=body.start or b.time_range.lower, now=now,
                # A move on the calendar keeps the job with its technician unless another is chosen.
                staff_ids=[body.staff_id or b.staff_id], respect_hours=not body.override_rules,
            )
        edits = body.model_dump(exclude_unset=True, include={"description", "notes", "urgency", "details"})
        if edits:
            if "details" in edits:
                edits["details"] = get_vertical(settings.vertical).validate_details(edits["details"])
            for key, value in edits.items():
                setattr(b, key, value)
            b.version += 1
            await session.flush()
            audit(session, ctx.business_id, ctx.actor, "booking.edit", "booking", b.id, fields=sorted(edits))
            if b.status == "confirmed":
                engine.after_commit_push(ctx, b.id, "update")
        return await _detail(session, ctx, b.id)

    return await run(ctx, fn)


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: uuid.UUID, body: CancelBody, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        b = await engine.lock_booking(session, ctx.business_id, booking_id)
        await engine.cancel(session, ctx, booking=b, reason=body.reason)
        return await _detail(session, ctx, b.id)

    return await run(ctx, fn)


@router.post("/bookings/{booking_id}/complete")
async def complete_booking(booking_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        b = await engine.lock_booking(session, ctx.business_id, booking_id)
        await engine.complete(session, ctx, booking=b)
        return await _detail(session, ctx, b.id)

    return await run(ctx, fn)


@router.get("/customers")
async def search_customers(q: str = Query(min_length=2, max_length=100), ctx: RequestContext = Depends(dashboard_context)) -> list[dict[str, Any]]:
    async def fn(session: AsyncSession) -> list[dict[str, Any]]:
        digits = "".join(ch for ch in q if ch.isdigit())
        conditions = [Customer.name.ilike(f"%{q}%")]
        if len(digits) >= 3:
            conditions.append(Customer.phone_e164.contains(digits))
        rows = (
            await session.scalars(
                select(Customer).where(Customer.business_id == ctx.business_id, or_(*conditions)).order_by(Customer.name).limit(20)
            )
        ).all()
        out = []
        for c in rows:
            addresses = (await session.scalars(select(CustomerAddress).where(CustomerAddress.customer_id == c.id))).all()
            out.append(
                {
                    "id": str(c.id),
                    "name": c.name,
                    "phone": c.phone_e164,
                    "email": c.email,
                    "addresses": [
                        {k: getattr(a, k) for k in ("line1", "line2", "city", "region", "postal_code", "country")}
                        for a in addresses
                    ],
                }
            )
        return out

    return await run(ctx, fn)


@router.post("/availability")
async def availability(body: AvailabilityQuery, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    if body.end - body.start > timedelta(days=MAX_CALENDAR_DAYS):
        raise ApiError("range_too_long", f"Ask for at most {MAX_CALENDAR_DAYS} days at a time.")

    async def fn(session: AsyncSession) -> dict[str, Any]:
        settings = await load_settings(session, ctx.business_id)
        service = await session.scalar(select(Service).where(Service.business_id == ctx.business_id, Service.id == body.service_id))
        if service is None:
            raise ApiError("not_found", "No such service.", status=404)
        q = SlotQuery(
            business_id=ctx.business_id, settings=settings, service=service, window_start=body.start,
            window_end=body.end, now=utcnow(), postal_code=normalize_postal(body.postal_code),
            staff_ids=[body.staff_id] if body.staff_id else None, urgency=body.urgency,
        )
        slots = await find_slots(session, q)
        tz = zone(settings.timezone)
        return {
            "timezone": settings.timezone,
            "slots": [
                {"start": s.start.astimezone(tz).isoformat(), "end": s.end.astimezone(tz).isoformat(), "staff_ids": [str(i) for i in s.staff_ids]}
                for s in slots
            ],
        }

    return await run(ctx, fn)

