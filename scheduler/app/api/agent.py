"""Tool endpoints the voice agent calls during a live call."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..context import RequestContext
from ..core import booking as engine
from ..core import idempotency
from ..core.availability import Slot, SlotQuery, find_slots
from ..core.customers import normalize_phone
from ..core.service_area import business_covers, normalize_postal, postal_from_address
from ..core.services import resolve_service
from ..core.settings import load_settings
from ..core.timeutil import (
    NAMED_WINDOWS,
    clock,
    day_label,
    local_day_bounds,
    parse_local_date,
    parse_local_slot,
    range_label,
    slot_id,
    spoken_start,
    time_window_phrase,
    utcnow,
    zone,
)
from ..errors import ApiError
from ..models import Booking, BusinessSettings, Customer, Service, Staff
from ..schemas.agent import (
    AppointmentOut,
    BookIn,
    BookOut,
    CancelIn,
    CancelOut,
    CheckAvailabilityIn,
    CheckAvailabilityOut,
    ErrorOut,
    FindIn,
    FindOut,
    HoldIn,
    HoldOut,
    RescheduleIn,
    ServiceRef,
    SlotOut,
    TimeRange,
)
from ..security.auth import agent_context
from .deps import run

ERRORS: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorOut},
    401: {"model": ErrorOut},
    404: {"model": ErrorOut},
    409: {"model": ErrorOut},
}
router = APIRouter(prefix="/agent", tags=["agent"], responses=ERRORS)

SEARCH_AHEAD_DAYS = 7


# ── helpers ──────────────────────────────────────────────────────────────────


def _slot_out(slot: Slot, tz: ZoneInfo, now: datetime) -> SlotOut:
    return SlotOut(
        slot_id=slot_id(slot.start, tz),
        start=slot.start.astimezone(tz).isoformat(),
        end=slot.end.astimezone(tz).isoformat(),
        label=range_label(slot.start, slot.end, tz, now),
        technicians_available=len(slot.staff_ids),
    )


def _part_of_day(dt: datetime) -> int:
    return 0 if dt.hour < 12 else 1 if dt.hour < 17 else 2


def spread(slots: list[Slot], limit: int, tz: ZoneInfo) -> list[Slot]:
    """Up to `limit` slots spread over days and morning/afternoon/evening rather than the first few
    back-to-back ones, so a caller hears real choices."""
    groups: dict[tuple[str, int], list[Slot]] = {}
    for s in slots:
        local = s.start.astimezone(tz)
        groups.setdefault((local.date().isoformat(), _part_of_day(local)), []).append(s)
    picked: list[Slot] = []
    depth = 0
    while len(picked) < limit and any(len(g) > depth for g in groups.values()):
        for group in groups.values():
            if depth < len(group) and len(picked) < limit:
                picked.append(group[depth])
        depth += 1
    return sorted(picked, key=lambda s: s.start)


def _window_minutes(window: str | TimeRange | None) -> tuple[int, int]:
    if window is None:
        return NAMED_WINDOWS["any"]
    if isinstance(window, TimeRange):
        h1, m1 = map(int, window.from_.split(":"))
        h2, m2 = map(int, window.to.split(":"))
        return h1 * 60 + m1, min(h2 * 60 + m2, 1440)
    return NAMED_WINDOWS[window]


def _in_window(slot: Slot, tz: ZoneInfo, window: tuple[int, int]) -> bool:
    local = slot.start.astimezone(tz)
    return window[0] <= local.hour * 60 + local.minute < window[1]


def _postal(postal_code: str | None, address: str | None) -> str | None:
    return normalize_postal(postal_code) or postal_from_address(address)


async def _technician_ids(session: AsyncSession, business_id: uuid.UUID, name: str | None) -> list[uuid.UUID] | None:
    if not name:
        return None
    needle = name.strip().lower()
    staff = (
        await session.scalars(select(Staff).where(Staff.business_id == business_id, Staff.active))
    ).all()
    exact = [s for s in staff if s.name.lower() == needle or s.first_name.lower() == needle]
    matches = exact or [s for s in staff if needle in s.name.lower()]
    if not matches:
        raise ApiError("unknown_technician", f"There's no technician called {name}. Offer the first available instead.")
    return [s.id for s in matches]


def _join_times(times: list[str]) -> str:
    return times[0] if len(times) == 1 else ", ".join(times[:-1]) + " or " + times[-1]


def _describe(slots: list[Slot], tz: ZoneInfo, now: datetime) -> str:
    """'tomorrow: 9:00 AM or 2:30 PM', or 'Friday, October 17 at 9:00 AM or Monday, October 20 at 8:00 AM'."""
    days = {s.start.astimezone(tz).date() for s in slots}
    if len(days) == 1:
        first = slots[0].start.astimezone(tz)
        return f"{day_label(first, now)}: {_join_times([clock(s.start.astimezone(tz)) for s in slots])}"
    return _join_times([spoken_start(s.start, tz, now) for s in slots])


async def _alternatives(
    session: AsyncSession, ctx: RequestContext, settings: BusinessSettings, service: Service, around: datetime,
    now: datetime, **kw: Any,
) -> list[dict[str, Any]]:
    tz = zone(settings.timezone)
    alts = await engine.alternatives(session, ctx, settings, service, around, now, exclude=around, **kw)
    return [_slot_out(s, tz, now).model_dump() for s in alts]


def _address_dict(address: Any) -> dict[str, Any] | None:
    if address is None:
        return None
    if isinstance(address, str):
        return {"line1": address, "postal_code": postal_from_address(address)} if address.strip() else None
    data = address.model_dump(exclude_none=True)
    if data.get("postal_code"):
        data["postal_code"] = normalize_postal(data["postal_code"])
    return data


def _address_short(address: dict[str, Any] | None) -> str | None:
    if not address:
        return None
    return ", ".join(p for p in (address.get("line1"), address.get("city")) if p) or None


async def _upcoming_for_phone(
    session: AsyncSession, business_id: uuid.UUID, phone: str, date: str | None, tz: ZoneInfo, now: datetime
) -> list[Booking]:
    phone_e164 = normalize_phone(phone)
    stmt = (
        select(Booking)
        .join(Customer, Customer.id == Booking.customer_id)
        .where(
            Booking.business_id == business_id,
            Customer.phone_e164 == phone_e164,
            Booking.status == "confirmed",
            func.upper(Booking.time_range) > now,
        )
        .order_by(func.lower(Booking.time_range))
        .limit(10)
    )
    bookings = list((await session.scalars(stmt)).all())
    if date:
        day = parse_local_date(date)
        bookings = [b for b in bookings if b.time_range.lower.astimezone(tz).date() == day]
    return bookings


async def _appointment_out(session: AsyncSession, b: Booking, tz: ZoneInfo, now: datetime) -> AppointmentOut:
    staff = await session.get(Staff, b.staff_id)
    service = await session.get(Service, b.service_id)
    return AppointmentOut(
        booking_id=b.id,
        confirmation_code=b.confirmation_code,
        status=b.status,
        start=b.time_range.lower.astimezone(tz).isoformat(),
        label=range_label(b.time_range.lower, b.time_range.upper, tz, now),
        service=service.name if service else "",
        technician_first_name=staff.first_name if staff else "",
        address_short=_address_short(b.service_address),
    )


async def _locate(
    session: AsyncSession, ctx: RequestContext, booking_id: uuid.UUID | None, phone: str | None, date: str | None,
    tz: ZoneInfo, now: datetime,
) -> Booking:
    """The appointment the caller means, by id or by their phone number (and date if they have several)."""
    if booking_id is not None:
        return await engine.lock_booking(session, ctx.business_id, booking_id)
    if not phone:
        raise ApiError("not_found", "I need the appointment or the phone number it was booked with.", status=404)
    found = await _upcoming_for_phone(session, ctx.business_id, phone, date, tz, now)
    if not found:
        raise ApiError("not_found", "I couldn't find an upcoming appointment for that phone number.", status=404)
    if len(found) > 1:
        options = [(await _appointment_out(session, b, tz, now)).model_dump(mode="json") for b in found]
        raise ApiError(
            "ambiguous",
            "There are several upcoming appointments for that number. Ask which one, then use its booking_id.",
            status=409,
            appointments=options,
        )
    return await engine.lock_booking(session, ctx.business_id, found[0].id)


def _booked_out(
    booking: Booking, staff: Staff, tz: ZoneInfo, now: datetime, verb: str
) -> BookOut:
    start, end = booking.time_range.lower, booking.time_range.upper
    date_label = day_label(start.astimezone(tz), now)
    window = time_window_phrase(start, end, tz)
    return BookOut(
        booking_id=booking.id,
        confirmation_code=booking.confirmation_code or "",
        start=start.astimezone(tz).isoformat(),
        end=end.astimezone(tz).isoformat(),
        date_label=date_label,
        time_window=window,
        technician_first_name=staff.first_name,
        message=(
            f"{verb} for {date_label}, arriving {window}, with {staff.first_name}. "
            f"The confirmation code is {booking.confirmation_code}."
        ),
    )


# ── endpoints ────────────────────────────────────────────────────────────────


@router.post("/check_availability", response_model=CheckAvailabilityOut)
async def check_availability(body: CheckAvailabilityIn, ctx: RequestContext = Depends(agent_context)) -> CheckAvailabilityOut:
    """Open times for a service, on a day or the next available ones."""

    async def fn(session: AsyncSession) -> CheckAvailabilityOut:
        settings = await load_settings(session, ctx.business_id)
        tz = zone(settings.timezone)
        service = await resolve_service(session, ctx.business_id, body.service)
        postal = _postal(body.postal_code, body.address)
        if not business_covers(settings.service_area, postal):
            raise ApiError("out_of_area", f"Sorry, {postal} is outside the area this business serves.")
        staff_ids = await _technician_ids(session, ctx.business_id, body.technician)
        now = utcnow()
        window = _window_minutes(body.time_window)

        async def search(start: datetime, end: datetime) -> list[Slot]:
            q = SlotQuery(
                business_id=ctx.business_id, settings=settings, service=service, window_start=start,
                window_end=end, now=now, postal_code=postal, staff_ids=staff_ids, urgency=body.urgency,
            )
            return [s for s in await find_slots(session, q) if _in_window(s, tz, window)]

        slots: list[Slot] = []
        lead = "Open times"
        if body.date:
            requested = parse_local_date(body.date)
            for offset in range(SEARCH_AHEAD_DAYS + 1):
                day = requested + timedelta(days=offset)
                start, end = local_day_bounds(day, tz)
                if start > now + timedelta(days=settings.max_days_ahead):
                    break
                slots = await search(start, end)
                if slots:
                    if offset:
                        asked = day_label(start.astimezone(tz) - timedelta(days=offset), now)
                        lead = f"Nothing is open {'on ' if ',' in asked else ''}{asked}. The next openings are"
                    break
        else:
            slots = await search(now, now + timedelta(days=SEARCH_AHEAD_DAYS))
            if not slots:
                slots = await search(now, now + timedelta(days=settings.max_days_ahead))
        if not slots:
            raise ApiError(
                "no_availability",
                "There are no openings in that time. Offer to take a message so the office can call back.",
            )

        chosen = slots[: body.limit] if body.urgency == "emergency" else spread(slots, body.limit, tz)
        message = f"{lead} {_describe(chosen, tz, now)}."
        return CheckAvailabilityOut(
            message=message,
            timezone=settings.timezone,
            service=ServiceRef(id=service.id, name=service.name, duration_min=service.duration_min),
            slots=[_slot_out(s, tz, now) for s in chosen],
        )

    return await run(ctx, fn)


@router.post("/hold_slot", response_model=HoldOut)
async def hold_slot(body: HoldIn, ctx: RequestContext = Depends(agent_context)) -> HoldOut:
    """Reserve a slot for a few minutes while the caller's details are collected."""

    async def fn(session: AsyncSession) -> HoldOut:
        if body.idempotency_key:
            payload = body.model_dump(mode="json", exclude={"idempotency_key"})
            if replay := await idempotency.claim(session, ctx.business_id, body.idempotency_key, "hold", payload):
                return HoldOut.model_validate(replay)
        settings = await load_settings(session, ctx.business_id)
        tz = zone(settings.timezone)
        service = await resolve_service(session, ctx.business_id, body.service)
        postal = _postal(body.postal_code, body.address)
        if not business_covers(settings.service_area, postal):
            raise ApiError("out_of_area", f"Sorry, {postal} is outside the area this business serves.")
        staff_ids = await _technician_ids(session, ctx.business_id, body.technician)
        start = parse_local_slot(body.slot_id, tz)
        now = utcnow()
        address = {"line1": body.address, "postal_code": postal} if body.address else None
        try:
            held = await engine.hold(
                session, ctx, settings=settings, service=service, start=start, now=now, source="voice_agent",
                postal_code=postal, service_address=address, staff_ids=staff_ids, urgency=body.urgency,
                call_id=body.call_id,
            )
        except ApiError as e:
            if e.code == "slot_unavailable":
                e.message = "That time was just taken. Offer one of the alternatives."
                e.extra["alternatives"] = await _alternatives(
                    session, ctx, settings, service, start, now, postal_code=postal, staff_ids=staff_ids,
                    urgency=body.urgency,
                )
            raise
        b = held.booking
        assert b.hold_expires_at is not None
        out = HoldOut(
            hold_id=b.id,
            slot_id=slot_id(start, tz),
            label=range_label(b.time_range.lower, b.time_range.upper, tz, now),
            expires_at=b.hold_expires_at.isoformat(),
            expires_in_sec=settings.hold_ttl_sec,
            technician_first_name=held.staff.first_name,
            message=(
                f"Held {spoken_start(start, tz, now)} with {held.staff.first_name} for "
                f"{settings.hold_ttl_sec // 60} minutes. Collect the caller's details, then call book_appointment."
            ),
        )
        if body.idempotency_key:
            await idempotency.store(session, ctx.business_id, body.idempotency_key, out.model_dump(mode="json"), b.id)
        return out

    return await run(ctx, fn)


@router.post("/book_appointment", response_model=BookOut)
async def book_appointment(body: BookIn, ctx: RequestContext = Depends(agent_context)) -> BookOut:
    """Confirm a held slot with the caller's details. Retrying with the same idempotency_key is safe."""

    async def fn(session: AsyncSession) -> BookOut:
        payload = body.model_dump(mode="json", exclude={"idempotency_key"})
        if replay := await idempotency.claim(session, ctx.business_id, body.idempotency_key, "book", payload):
            return BookOut.model_validate(replay)
        settings = await load_settings(session, ctx.business_id)
        tz = zone(settings.timezone)
        now = utcnow()
        held = await engine.lock_booking(session, ctx.business_id, body.hold_id)
        customer = engine.CustomerInput(
            name=body.customer_name,
            phone_e164=normalize_phone(body.phone),
            email=body.email or None,
            address=_address_dict(body.address),
        )
        try:
            booking = await engine.confirm(
                session, ctx, settings=settings, booking=held, customer=customer, now=now,
                description=body.issue_description, urgency=body.urgency, call_id=body.call_id, details=body.details,
            )
        except ApiError as e:
            if e.code in ("slot_conflict", "hold_expired"):
                service = await session.get(Service, held.service_id)
                assert service is not None
                e.message += " Offer one of the alternatives."
                e.extra["alternatives"] = await _alternatives(
                    session, ctx, settings, service, held.time_range.lower, now, urgency=held.urgency
                )
                if e.keep_changes:
                    await idempotency.release(session, ctx.business_id, body.idempotency_key)
            raise
        staff = await session.get(Staff, booking.staff_id)
        assert staff is not None
        out = _booked_out(booking, staff, tz, now, "Booked")
        await idempotency.store(session, ctx.business_id, body.idempotency_key, out.model_dump(mode="json"), booking.id)
        return out

    return await run(ctx, fn)


@router.post("/find_appointments", response_model=FindOut)
async def find_appointments(body: FindIn, ctx: RequestContext = Depends(agent_context)) -> FindOut:
    """Upcoming appointments booked with a phone number (usually the caller's)."""

    async def fn(session: AsyncSession) -> FindOut:
        settings = await load_settings(session, ctx.business_id)
        tz = zone(settings.timezone)
        now = utcnow()
        bookings = await _upcoming_for_phone(session, ctx.business_id, body.phone, body.date, tz, now)
        appointments = [await _appointment_out(session, b, tz, now) for b in bookings]
        if not appointments:
            message = "There are no upcoming appointments for that phone number."
        elif len(appointments) == 1:
            a = appointments[0]
            message = f"One upcoming appointment: {a.service}, {a.label}, with {a.technician_first_name}."
        else:
            message = f"{len(appointments)} upcoming appointments: " + "; ".join(
                f"{a.service}, {a.label}" for a in appointments
            ) + "."
        return FindOut(appointments=appointments, message=message)

    return await run(ctx, fn)


@router.post("/reschedule_appointment", response_model=BookOut)
async def reschedule_appointment(body: RescheduleIn, ctx: RequestContext = Depends(agent_context)) -> BookOut:
    """Move an appointment to a new slot from check_availability, in one step."""

    async def fn(session: AsyncSession) -> BookOut:
        payload = body.model_dump(mode="json", exclude={"idempotency_key"})
        if replay := await idempotency.claim(session, ctx.business_id, body.idempotency_key, "reschedule", payload):
            return BookOut.model_validate(replay)
        settings = await load_settings(session, ctx.business_id)
        tz = zone(settings.timezone)
        now = utcnow()
        booking = await _locate(session, ctx, body.booking_id, body.phone, body.date, tz, now)
        new_start = parse_local_slot(body.new_slot_id, tz)
        try:
            booking = await engine.reschedule(session, ctx, settings=settings, booking=booking, new_start=new_start, now=now)
        except ApiError as e:
            if e.code in ("slot_unavailable", "slot_conflict"):
                service = await session.get(Service, booking.service_id)
                assert service is not None
                e.message += " Offer one of the alternatives."
                e.extra["alternatives"] = await _alternatives(
                    session, ctx, settings, service, new_start, now, urgency=booking.urgency
                )
            raise
        staff = await session.get(Staff, booking.staff_id)
        assert staff is not None
        out = _booked_out(booking, staff, tz, now, "Moved")
        await idempotency.store(session, ctx.business_id, body.idempotency_key, out.model_dump(mode="json"), booking.id)
        return out

    return await run(ctx, fn)


@router.post("/cancel_appointment", response_model=CancelOut)
async def cancel_appointment(body: CancelIn, ctx: RequestContext = Depends(agent_context)) -> CancelOut:
    """Cancel an appointment, found by id or by phone number (and date)."""

    async def fn(session: AsyncSession) -> CancelOut:
        payload = body.model_dump(mode="json", exclude={"idempotency_key"})
        if replay := await idempotency.claim(session, ctx.business_id, body.idempotency_key, "cancel", payload):
            return CancelOut.model_validate(replay)
        settings = await load_settings(session, ctx.business_id)
        tz = zone(settings.timezone)
        now = utcnow()
        booking = await _locate(session, ctx, body.booking_id, body.phone, body.date, tz, now)
        booking = await engine.cancel(session, ctx, booking=booking, reason=body.reason)
        label = range_label(booking.time_range.lower, booking.time_range.upper, tz, now)
        out = CancelOut(booking_id=booking.id, status=booking.status, message=f"Canceled the appointment for {label}.")
        await idempotency.store(session, ctx.business_id, body.idempotency_key, out.model_dump(mode="json"), booking.id)
        return out

    return await run(ctx, fn)
