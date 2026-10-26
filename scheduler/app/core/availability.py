"""Availability: which staff can take a job of a given service, when.

For each candidate (active, has the service's skills, covers the postal code):
    free = working hours − time off − our held/confirmed jobs − external busy blocks
and a start time `t` is offered when the job [t, t+duration) lies inside working hours and the
blocked range [t−buffer_before, t+duration+buffer_after) touches nothing busy. The bookings exclusion
constraint enforces the same rule on blocked ranges, so any slot listed here can be held unless
someone takes it first.

Everything is loaded with a handful of set-based queries and computed in memory; the voice agent
calls this on a live call.
"""

from __future__ import annotations

import time as _time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, any_, func, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.ext.asyncio import AsyncSession

from .. import metrics
from ..connectors.live import cached_busy
from ..models import Booking, BusinessSettings, ConnectedAccount, Service, Staff, TimeOff, WorkingHours
from .intervals import Interval, expand_weekly, normalize, overlaps_any, subtract
from .timeutil import zone


@dataclass
class SlotQuery:
    business_id: uuid.UUID
    settings: BusinessSettings
    service: Service
    window_start: datetime
    window_end: datetime
    now: datetime
    postal_code: str | None = None
    staff_ids: list[uuid.UUID] | None = None
    urgency: str = "standard"
    # When moving a booking, its own current time doesn't count as busy.
    ignore_booking_id: uuid.UUID | None = None


@dataclass
class Slot:
    start: datetime
    end: datetime
    staff_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass
class _StaffDay:
    staff: Staff
    work: list[Interval]
    busy: list[Interval]
    jobs_per_day: dict[str, int]
    cap: int | None


def _durations(service: Service) -> tuple[timedelta, timedelta, timedelta]:
    return (
        timedelta(minutes=service.duration_min),
        timedelta(minutes=service.buffer_before_min),
        timedelta(minutes=service.buffer_after_min),
    )


def bookable_bounds(q: SlotQuery) -> tuple[datetime, datetime]:
    """The search window clipped to minimum notice and how far ahead bookings are allowed."""
    notice = q.settings.emergency_min_notice_min if q.urgency == "emergency" else q.settings.min_notice_min
    earliest = max(q.window_start, q.now + timedelta(minutes=notice))
    latest = min(q.window_end, q.now + timedelta(days=q.settings.max_days_ahead))
    return earliest, latest


async def candidate_staff(session: AsyncSession, q: SlotQuery) -> list[Staff]:
    stmt = select(Staff).where(Staff.business_id == q.business_id, Staff.active)
    if q.service.required_skills:
        stmt = stmt.where(Staff.skills.contains(q.service.required_skills))
    if q.postal_code:
        stmt = stmt.where(or_(func.cardinality(Staff.zones) == 0, q.postal_code == any_(Staff.zones)))
    if q.staff_ids is not None:
        stmt = stmt.where(Staff.id.in_(q.staff_ids))
    if q.settings.unavailable_on_reauth:
        # A calendar we can no longer read could hide anything: don't auto-book that person.
        stmt = stmt.where(
            ~select(ConnectedAccount.id)
            .where(ConnectedAccount.staff_id == Staff.id, ConnectedAccount.kind == "calendar", ConnectedAccount.status == "needs_reauth")
            .exists()
        )
    return list((await session.scalars(stmt.order_by(Staff.priority.desc(), Staff.name, Staff.id))).all())


async def _load(
    session: AsyncSession, q: SlotQuery, staff: list[Staff], start: datetime, end: datetime
) -> list[_StaffDay]:
    if not staff:
        return []
    business_tz = zone(q.settings.timezone)
    ids = [s.id for s in staff]
    # Whole local days around the window: shifts that cross midnight, buffers, and per-day job caps
    # all need the neighbouring hours.
    pad_start, pad_end = start - timedelta(days=1), end + timedelta(days=1)
    span = Range(pad_start, pad_end, bounds="[)")

    hours_rows = (
        await session.execute(
            select(WorkingHours.staff_id, WorkingHours.weekday, WorkingHours.start_min, WorkingHours.end_min).where(
                WorkingHours.business_id == q.business_id, WorkingHours.staff_id.in_(ids)
            )
        )
    ).all()
    off_rows = (
        await session.execute(
            select(TimeOff.staff_id, TimeOff.period).where(
                TimeOff.business_id == q.business_id, TimeOff.staff_id.in_(ids), TimeOff.period.overlaps(span)
            )
        )
    ).all()
    booking_filter = [
        Booking.business_id == q.business_id,
        Booking.staff_id.in_(ids),
        Booking.blocked_range.overlaps(span),
        or_(Booking.status == "confirmed", and_(Booking.status == "held", Booking.hold_expires_at > q.now)),
    ]
    if q.ignore_booking_id is not None:
        booking_filter.append(Booking.id != q.ignore_booking_id)
    booking_rows = (
        await session.execute(select(Booking.staff_id, Booking.time_range, Booking.blocked_range).where(*booking_filter))
    ).all()
    external = await cached_busy(session, q.business_id, ids, pad_start, pad_end)

    hours: dict[uuid.UUID, list[tuple[int, int, int]]] = defaultdict(list)
    for staff_id, weekday, start_min, end_min in hours_rows:
        hours[staff_id].append((weekday, start_min, end_min))
    off: dict[uuid.UUID, list[Interval]] = defaultdict(list)
    for staff_id, period in off_rows:
        off[staff_id].append((period.lower or pad_start, period.upper or pad_end))
    busy: dict[uuid.UUID, list[Interval]] = defaultdict(list)
    per_day: dict[uuid.UUID, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for staff_id, time_range, blocked in booking_rows:
        busy[staff_id].append((blocked.lower, blocked.upper))
        per_day[staff_id][time_range.lower.astimezone(business_tz).date().isoformat()] += 1
    for staff_id, intervals in external.items():
        busy[staff_id].extend(intervals)

    out: list[_StaffDay] = []
    for s in staff:
        tz = zone(s.timezone) if s.timezone else business_tz
        first_day = pad_start.astimezone(tz).date()
        last_day = pad_end.astimezone(tz).date()
        work = subtract(expand_weekly(hours[s.id], tz, first_day, last_day), off[s.id])
        out.append(
            _StaffDay(
                staff=s,
                work=work,
                # Time off is busy too, so a job's travel buffer can't run into it.
                busy=normalize(busy[s.id] + off[s.id]),
                jobs_per_day=per_day[s.id],
                cap=s.daily_job_cap or q.settings.default_daily_job_cap,
            )
        )
    return out


def _ceil_to_grid(t: datetime, granularity: int, tz: ZoneInfo) -> datetime:
    """Round up to the next slot boundary on the business's local clock (e.g. :00 and :30)."""
    local = t.astimezone(tz)
    minutes = local.hour * 60 + local.minute
    remainder = minutes % granularity
    extra = local.second * 1_000_000 + local.microsecond
    if remainder == 0 and extra == 0:
        return t
    return t + timedelta(minutes=granularity - remainder) - timedelta(seconds=local.second, microseconds=local.microsecond)


def _fits(day: _StaffDay, start: datetime, q: SlotQuery, business_tz: ZoneInfo, *, respect_hours: bool) -> bool:
    duration, before, after = _durations(q.service)
    end = start + duration
    if respect_hours and not any(w_start <= start and end <= w_end for w_start, w_end in day.work):
        return False
    if overlaps_any(day.busy, (start - before, end + after)):
        return False
    if respect_hours and day.cap is not None:
        if day.jobs_per_day.get(start.astimezone(business_tz).date().isoformat(), 0) >= day.cap:
            return False
    return True


async def find_slots(session: AsyncSession, q: SlotQuery) -> list[Slot]:
    """Every bookable start in the window, with the staff who can take it, earliest first."""
    started = _time.perf_counter()
    earliest, latest = bookable_bounds(q)
    if earliest >= latest:
        return []
    staff = await candidate_staff(session, q)
    days = await _load(session, q, staff, earliest, latest)
    business_tz = zone(q.settings.timezone)
    duration, _, _ = _durations(q.service)
    step = timedelta(minutes=q.settings.slot_granularity_min)

    by_start: dict[datetime, list[uuid.UUID]] = defaultdict(list)
    for day in days:
        for w_start, w_end in day.work:
            if w_end <= earliest or w_start >= latest:
                continue
            t = _ceil_to_grid(max(w_start, earliest), q.settings.slot_granularity_min, business_tz)
            while t < latest and t + duration <= w_end:
                if _fits(day, t, q, business_tz, respect_hours=True):
                    by_start[t].append(day.staff.id)
                t += step
    slots = [Slot(start=t, end=t + duration, staff_ids=ids) for t, ids in sorted(by_start.items())]
    metrics.AVAILABILITY_SECONDS.observe(_time.perf_counter() - started)
    return slots


async def free_staff_at(
    session: AsyncSession, q: SlotQuery, start: datetime, *, respect_hours: bool = True
) -> list[Staff]:
    """Candidates who can take a job starting exactly at `start`. With respect_hours=False (an owner
    booking by hand), working hours, notice and daily caps are ignored but overlaps never are."""
    if respect_hours:
        earliest, latest = bookable_bounds(q)
        if not (earliest <= start < latest):
            return []
    staff = await candidate_staff(session, q)
    duration, before, after = _durations(q.service)
    days = await _load(session, q, staff, start - before, start + duration + after)
    business_tz = zone(q.settings.timezone)
    return [d.staff for d in days if _fits(d, start, q, business_tz, respect_hours=respect_hours)]
