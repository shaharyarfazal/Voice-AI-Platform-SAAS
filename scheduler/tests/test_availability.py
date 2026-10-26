"""Availability rules, exercised through the engine and the dashboard availability endpoint."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.availability import SlotQuery, find_slots
from app.db import tenant_session
from app.models import BusinessSettings, Service

from .conftest import local, next_weekday


async def slots_for(client, biz, service_id, day, **extra):
    start = local(day, "00:00", biz.tz)
    res = await client.post(
        "/v1/availability",
        json={"service_id": str(service_id), "start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat(), **extra},
        headers=biz.dashboard_headers(),
    )
    assert res.status_code == 200, res.text
    return res.json()["slots"]


def times(slots):
    return [datetime.fromisoformat(s["start"]).strftime("%H:%M") for s in slots]


async def test_slots_cover_working_hours_on_the_grid(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    service = await factory.service(biz, duration=60)
    slots = await slots_for(client, biz, service, next_weekday(biz.tz))
    # 08:00 … 16:00 every 30 minutes: the last job must end by 17:00.
    assert times(slots) == [f"{h:02d}:{m:02d}" for h in range(8, 17) for m in (0, 30)][:-1]


async def test_buffers_keep_travel_time_between_jobs(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    service = await factory.service(biz, duration=60, before=30, after=30)
    day = next_weekday(biz.tz)
    res = await client.post(
        "/v1/bookings",
        json={
            "service_id": str(service), "start": local(day, "10:00", biz.tz).isoformat(),
            "customer": {"name": "Jane Doe", "phone": "+12125550100"},
        },
        headers=biz.dashboard_headers(),
    )
    assert res.status_code == 201, res.text
    got = times(await slots_for(client, biz, service, day))
    # The 10:00 job blocks 09:30–11:30; a new job needs 30 minutes either side of it too.
    assert "08:00" in got and "12:00" in got
    assert not {"08:30", "09:00", "10:00", "11:00", "11:30"} & set(got)


async def test_time_off_and_skills_and_zones(client, factory):
    biz = await factory.business()
    mike = await factory.staff(biz, "Mike Ross", skills=["ac_repair"], zones=["10001"])
    anna = await factory.staff(biz, "Anna Lee", skills=["furnace_repair"])
    ac = await factory.service(biz, "AC repair", duration=60, skills=["ac_repair"])
    plain = await factory.service(biz, "Estimate", duration=60)
    day = next_weekday(biz.tz)
    await factory.time_off(biz, mike, local(day, "12:00", biz.tz), local(day, "14:00", biz.tz))

    ac_slots = await slots_for(client, biz, ac, day)
    assert all(s["staff_ids"] == [str(mike)] for s in ac_slots)  # only Mike has the skill
    assert not {"11:30", "12:00", "13:00", "13:30"} & set(times(ac_slots))  # time off

    # Mike only covers 10001; Anna covers everywhere.
    other_zip = await slots_for(client, biz, plain, day, postal_code="10002")
    assert all(s["staff_ids"] == [str(anna)] for s in other_zip)
    assert await slots_for(client, biz, ac, day, postal_code="10002") == []


async def test_daily_cap(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross", daily_job_cap=1)
    service = await factory.service(biz, duration=60)
    day = next_weekday(biz.tz)
    res = await client.post(
        "/v1/bookings",
        json={"service_id": str(service), "start": local(day, "09:00", biz.tz).isoformat(), "customer": {"name": "A", "phone": "+12125550101"}},
        headers=biz.dashboard_headers(),
    )
    assert res.status_code == 201, res.text
    assert await slots_for(client, biz, service, day) == []
    assert await slots_for(client, biz, service, day + timedelta(days=1)) != []


async def test_minimum_notice_and_max_days_ahead(factory):
    biz = await factory.business(min_notice_min=24 * 60, max_days_ahead=10)
    await factory.staff(biz, "Mike Ross", hours=[(d, "00:00", "24:00") for d in range(7)])
    service_id = await factory.service(biz, duration=60)
    now = datetime(2026, 6, 1, 12, tzinfo=UTC)
    async with tenant_session(biz.id) as session:
        settings = await session.get(BusinessSettings, biz.id)
        service = await session.get(Service, service_id)
        q = SlotQuery(biz.id, settings, service, now, now + timedelta(days=60), now)
        slots = await find_slots(session, q)
    assert slots[0].start == now + timedelta(days=1)
    assert slots[-1].start < now + timedelta(days=10)


async def test_dst_fall_back_day_has_local_hours(factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross", hours=[(6, "08:00", "17:00")])  # Sundays
    service_id = await factory.service(biz, duration=60)
    now = datetime(2026, 10, 25, tzinfo=UTC)
    async with tenant_session(biz.id) as session:
        settings = await session.get(BusinessSettings, biz.id)
        service = await session.get(Service, service_id)
        # Sunday 1 November 2026, the day clocks go back: 08:00 EST is 13:00Z.
        day_start = datetime(2026, 11, 1, 4, tzinfo=UTC)
        slots = await find_slots(session, SlotQuery(biz.id, settings, service, day_start, day_start + timedelta(days=1), now))
    assert slots[0].start == datetime(2026, 11, 1, 13, tzinfo=UTC)
    assert slots[-1].start == datetime(2026, 11, 1, 21, tzinfo=UTC)  # 16:00 EST
    assert len(slots) == 17


async def test_expired_hold_does_not_block(client, factory):
    biz = await factory.business()
    staff = await factory.staff(biz, "Mike Ross")
    service = await factory.service(biz, duration=60)
    day = next_weekday(biz.tz)
    start = local(day, "09:00", biz.tz)
    await factory.execute(
        "INSERT INTO sched.bookings (business_id, staff_id, service_id, time_range, blocked_range, status, hold_expires_at, source) "
        "VALUES (:b, :s, :v, tstzrange(:a, :e), tstzrange(:a, :e), 'held', now() - interval '1 minute', 'voice_agent')",
        b=biz.id, s=staff, v=service, a=start, e=start + timedelta(hours=1),
    )
    assert "09:00" in times(await slots_for(client, biz, service, day))
    res = await client.post(
        "/agent/hold_slot", json={"slot_id": start.strftime("%Y-%m-%dT%H:%M"), "service": "AC repair"}, headers=biz.agent_headers
    )
    assert res.status_code == 200, res.text
    statuses = await factory.scalar("SELECT array_agg(status ORDER BY created_at) FROM sched.bookings WHERE business_id = :b", b=biz.id)
    assert statuses == ["expired", "held"]


async def test_service_lookup_is_forgiving(factory):
    from app.core.services import resolve_service

    biz = await factory.business()
    await factory.service(biz, "AC repair")
    await factory.service(biz, "Furnace repair")
    async with tenant_session(biz.id) as session:
        assert (await resolve_service(session, biz.id, "ac repairs")).name == "AC repair"
        assert (await resolve_service(session, biz.id, "furnace")).name == "Furnace repair"
        found = (await session.scalars(select(Service))).all()
        assert len(found) == 2
