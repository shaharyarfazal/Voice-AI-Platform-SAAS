"""Acceptance: simultaneous calls can never double-book a technician."""

import asyncio
import uuid
from collections import Counter
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.errors import is_exclusion_violation

from .conftest import local, next_weekday

CALLERS = 50


async def hold_many(client, biz, slot_id, n=CALLERS):
    async def one(i):
        return await client.post(
            "/agent/hold_slot",
            json={"slot_id": slot_id, "service": "AC repair", "call_id": f"call-{i}"},
            headers=biz.agent_headers,
        )

    return await asyncio.gather(*(one(i) for i in range(n)))


async def test_fifty_callers_one_technician_one_wins(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    await factory.service(biz, "AC repair", duration=60, after=30)
    slot = f"{next_weekday(biz.tz).isoformat()}T10:00"

    results = await hold_many(client, biz, slot)
    codes = Counter(r.status_code for r in results)
    assert codes == {200: 1, 409: CALLERS - 1}, codes
    assert all(r.json()["code"] == "slot_unavailable" for r in results if r.status_code == 409)
    assert await factory.scalar("SELECT count(*) FROM sched.bookings WHERE status = 'held'") == 1


async def test_two_technicians_two_winners_on_different_technicians(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    await factory.staff(biz, "Anna Lee")
    await factory.service(biz, "AC repair", duration=60)
    slot = f"{next_weekday(biz.tz).isoformat()}T10:00"

    results = await hold_many(client, biz, slot)
    winners = [r.json() for r in results if r.status_code == 200]
    assert len(winners) == 2
    assert {w["technician_first_name"] for w in winners} == {"Mike", "Anna"}


async def test_overlapping_but_different_slots_race(client, factory):
    """Callers racing for 10:00 and 10:30 with a 60-minute job: those overlap, so only one wins."""
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    await factory.service(biz, "AC repair", duration=60)
    day = next_weekday(biz.tz).isoformat()
    a, b = await asyncio.gather(hold_many(client, biz, f"{day}T10:00", 20), hold_many(client, biz, f"{day}T10:30", 20))
    assert sum(r.status_code == 200 for r in a + b) == 1


async def test_database_rejects_overlap_even_without_availability_check(factory, admin):
    """The guarantee holds even if application code is wrong (e.g. a stale cache said "free"): 20
    concurrent raw inserts of overlapping jobs for one person, exactly one commits."""
    biz = await factory.business()
    staff = await factory.staff(biz, "Mike Ross")
    service = await factory.service(biz, duration=60)
    start = local(next_weekday(biz.tz), "10:00", biz.tz)

    async def insert(offset_min):
        s = start + timedelta(minutes=offset_min)
        try:
            async with admin.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO sched.bookings (business_id, staff_id, service_id, time_range, blocked_range, status, hold_expires_at, source) "
                        "VALUES (:b, :s, :v, tstzrange(:a, :e), tstzrange(:a, :e), 'held', now() + interval '3 minutes', 'voice_agent')"
                    ),
                    {"b": biz.id, "s": staff, "v": service, "a": s, "e": s + timedelta(minutes=60)},
                )
                await asyncio.sleep(0.05)  # hold the transaction open so the others really overlap
            return "ok"
        except IntegrityError as e:
            assert is_exclusion_violation(e)
            return "blocked"

    results = await asyncio.gather(*(insert(i % 30) for i in range(20)))
    assert Counter(results) == {"ok": 1, "blocked": 19}


async def test_concurrent_retries_of_one_booking_create_it_once(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    await factory.service(biz, "AC repair", duration=60)
    res = await client.post(
        "/agent/hold_slot", json={"slot_id": f"{next_weekday(biz.tz).isoformat()}T10:00", "service": "AC repair"},
        headers=biz.agent_headers,
    )
    hold_id = res.json()["hold_id"]
    payload = {"hold_id": hold_id, "customer_name": "John Smith", "phone": "2125550100", "idempotency_key": str(uuid.uuid4())}
    results = await asyncio.gather(
        *(client.post("/agent/book_appointment", json=payload, headers=biz.agent_headers) for _ in range(10))
    )
    assert all(r.status_code == 200 for r in results), [r.text for r in results if r.status_code != 200]
    assert len({r.json()["booking_id"] for r in results}) == 1
    assert len({r.json()["confirmation_code"] for r in results}) == 1
    assert await factory.scalar("SELECT count(*) FROM sched.bookings WHERE status = 'confirmed'") == 1
