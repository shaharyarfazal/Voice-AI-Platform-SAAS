from app.worker.tasks import expire_holds_job

from .conftest import next_weekday


async def test_expire_holds_job_releases_lapsed_holds_across_businesses(client, factory):
    holds = []
    for _ in range(2):
        biz = await factory.business()
        await factory.staff(biz, "Mike Ross")
        await factory.service(biz, "AC repair")
        res = await client.post(
            "/agent/hold_slot", json={"slot_id": f"{next_weekday(biz.tz).isoformat()}T10:00", "service": "AC repair"},
            headers=biz.agent_headers,
        )
        holds.append(res.json()["hold_id"])
    await factory.execute("UPDATE sched.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :i", i=holds[0])
    await factory.execute("UPDATE sched.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :i", i=holds[1])

    assert await expire_holds_job({}) == 2
    assert await factory.scalar("SELECT count(*) FROM sched.bookings WHERE status = 'expired'") == 2
    assert await factory.scalar("SELECT count(*) FROM sched.booking_events WHERE kind = 'expired' AND actor_type = 'system'") == 2
    assert await expire_holds_job({}) == 0
