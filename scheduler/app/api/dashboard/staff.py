from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.ext.asyncio import AsyncSession

from ...context import RequestContext
from ...core.audit import audit
from ...core.customers import normalize_phone
from ...core.timeutil import zone
from ...errors import ApiError
from ...models import Staff, TimeOff, WorkingHours
from ...schemas.dashboard import StaffIn, StaffPatch, TimeOffIn, WorkingHoursIn, WorkingWindow
from ...security.auth import dashboard_context, require_admin
from ..deps import run
from .serialize import staff_out

router = APIRouter()


async def _staff(session: AsyncSession, ctx: RequestContext, staff_id: uuid.UUID) -> Staff:
    s = await session.scalar(select(Staff).where(Staff.business_id == ctx.business_id, Staff.id == staff_id))
    if s is None:
        raise ApiError("not_found", "No such staff member.", status=404)
    return s


@router.get("/staff")
async def list_staff(ctx: RequestContext = Depends(dashboard_context)) -> list[dict[str, Any]]:
    async def fn(session: AsyncSession) -> list[dict[str, Any]]:
        staff = (await session.scalars(select(Staff).where(Staff.business_id == ctx.business_id).order_by(Staff.name))).all()
        hours = (await session.scalars(select(WorkingHours).where(WorkingHours.business_id == ctx.business_id))).all()
        by_staff: dict[uuid.UUID, list[WorkingHours]] = defaultdict(list)
        for h in hours:
            by_staff[h.staff_id].append(h)
        return [staff_out(s, by_staff[s.id]) for s in staff]

    return await run(ctx, fn)


@router.post("/staff", status_code=201)
async def create_staff(body: StaffIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    require_admin(ctx)
    if body.timezone:
        zone(body.timezone)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        data = body.model_dump(exclude={"phone"})
        s = Staff(business_id=ctx.business_id, phone_e164=normalize_phone(body.phone) if body.phone else None, **data)
        session.add(s)
        await session.flush()
        audit(session, ctx.business_id, ctx.actor, "staff.create", "staff", s.id, name=s.name)
        return staff_out(s, [])

    return await run(ctx, fn)


@router.patch("/staff/{staff_id}")
async def update_staff(staff_id: uuid.UUID, body: StaffPatch, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    require_admin(ctx)
    if body.timezone:
        zone(body.timezone)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        s = await _staff(session, ctx, staff_id)
        changes = body.model_dump(exclude_unset=True)
        if "phone" in changes:
            phone = changes.pop("phone")
            s.phone_e164 = normalize_phone(phone) if phone else None
        for key, value in changes.items():
            setattr(s, key, value)
        await session.flush()
        audit(session, ctx.business_id, ctx.actor, "staff.update", "staff", s.id, **changes)
        hours = (await session.scalars(select(WorkingHours).where(WorkingHours.staff_id == s.id))).all()
        return staff_out(s, list(hours))

    return await run(ctx, fn)


@router.put("/staff/{staff_id}/working-hours")
async def set_working_hours(
    staff_id: uuid.UUID, body: WorkingHoursIn, ctx: RequestContext = Depends(dashboard_context)
) -> dict[str, Any]:
    """Replace the staff member's whole weekly schedule."""
    require_admin(ctx)
    by_day: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for w in body.windows:
        by_day[w.weekday].append((WorkingWindow.minutes(w.start), WorkingWindow.minutes(w.end)))
    for windows in by_day.values():
        windows.sort()
        if any(a[1] > b[0] for a, b in zip(windows, windows[1:])):
            raise ApiError("overlapping_hours", "Working windows on the same day can't overlap.")

    async def fn(session: AsyncSession) -> dict[str, Any]:
        s = await _staff(session, ctx, staff_id)
        await session.execute(delete(WorkingHours).where(WorkingHours.staff_id == s.id))
        rows = [
            WorkingHours(business_id=ctx.business_id, staff_id=s.id, weekday=day, start_min=a, end_min=b)
            for day, windows in by_day.items()
            for a, b in windows
        ]
        session.add_all(rows)
        await session.flush()
        audit(session, ctx.business_id, ctx.actor, "staff.working_hours", "staff", s.id, windows=len(rows))
        return staff_out(s, rows)

    return await run(ctx, fn)


@router.get("/staff/{staff_id}/time-off")
async def list_time_off(staff_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> list[dict[str, Any]]:
    async def fn(session: AsyncSession) -> list[dict[str, Any]]:
        s = await _staff(session, ctx, staff_id)
        rows = (await session.scalars(select(TimeOff).where(TimeOff.staff_id == s.id).order_by(TimeOff.period))).all()
        return [
            {"id": str(r.id), "start": r.period.lower.isoformat(), "end": r.period.upper.isoformat(), "reason": r.reason}
            for r in rows
        ]

    return await run(ctx, fn)


@router.post("/staff/{staff_id}/time-off", status_code=201)
async def add_time_off(staff_id: uuid.UUID, body: TimeOffIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    require_admin(ctx)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        s = await _staff(session, ctx, staff_id)
        row = TimeOff(
            business_id=ctx.business_id, staff_id=s.id, period=Range(body.start, body.end, bounds="[)"), reason=body.reason
        )
        session.add(row)
        await session.flush()
        audit(session, ctx.business_id, ctx.actor, "staff.time_off.add", "staff", s.id, start=body.start, end=body.end)
        return {"id": str(row.id), "start": body.start.isoformat(), "end": body.end.isoformat(), "reason": row.reason}

    return await run(ctx, fn)


@router.delete("/staff/{staff_id}/time-off/{time_off_id}", status_code=204)
async def delete_time_off(staff_id: uuid.UUID, time_off_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> None:
    require_admin(ctx)

    async def fn(session: AsyncSession) -> None:
        result = await session.execute(
            delete(TimeOff).where(
                TimeOff.business_id == ctx.business_id, TimeOff.staff_id == staff_id, TimeOff.id == time_off_id
            )
        )
        if result.rowcount == 0:
            raise ApiError("not_found", "No such time off.", status=404)
        audit(session, ctx.business_id, ctx.actor, "staff.time_off.delete", "staff", staff_id, time_off_id=time_off_id)

    await run(ctx, fn)
