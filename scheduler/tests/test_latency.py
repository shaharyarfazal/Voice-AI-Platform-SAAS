"""check_availability answers while a caller waits; keep it well under the 1.5s budget."""

import statistics
import time
from datetime import timedelta

from .conftest import local, next_weekday


async def test_check_availability_p95_under_300ms(client, factory, admin):
    biz = await factory.business(max_days_ahead=45)
    staff = [await factory.staff(biz, f"Tech {i:02d}", skills=["ac_repair"]) for i in range(10)]
    service = await factory.service(biz, "AC repair", duration=90, before=15, after=15, skills=["ac_repair"])
    customer = await factory.scalar(
        "INSERT INTO sched.customers (business_id, name, phone_e164) VALUES (:b, 'Load', '+12125550000') RETURNING id", b=biz.id
    )
    first = next_weekday(biz.tz, weekday=0, min_days=1)
    rows = []
    for d in range(30):
        day = first + timedelta(days=d)
        if day.weekday() >= 5:
            continue
        for s in staff:
            for hour in ("09:00", "13:00"):
                start = local(day, hour, biz.tz)
                rows.append({"b": biz.id, "s": s, "v": service, "c": customer, "a": start, "e": start + timedelta(minutes=90),
                             "ba": start - timedelta(minutes=15), "be": start + timedelta(minutes=105)})
    from sqlalchemy import text

    async with admin.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO sched.bookings (business_id, staff_id, service_id, customer_id, time_range, blocked_range, status, source) "
                "VALUES (:b, :s, :v, :c, tstzrange(:a, :e), tstzrange(:ba, :be), 'confirmed', 'dashboard')"
            ),
            rows,
        )
    assert len(rows) >= 400

    timings = []
    for i in range(30):
        body = {"service": "AC repair", "date": (first + timedelta(days=i % 20)).isoformat()} if i % 2 else {"service": "AC repair"}
        started = time.perf_counter()
        res = await client.post("/agent/check_availability", json=body, headers=biz.agent_headers)
        timings.append(time.perf_counter() - started)
        assert res.status_code == 200, res.text
    p95 = statistics.quantiles(timings, n=20)[-1]
    print(f"check_availability p50={statistics.median(timings) * 1000:.0f}ms p95={p95 * 1000:.0f}ms over {len(rows)} bookings")
    assert p95 < 0.3
