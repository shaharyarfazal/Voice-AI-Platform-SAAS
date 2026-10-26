"""Tenant isolation, dashboard auth, and token encryption compatibility with the web app."""

import time
import uuid

import jwt
from sqlalchemy import text

from app.db import tenant_session
from app.security.crypto import decrypt, encrypt

from .conftest import JWT_SECRET, next_weekday

# Produced by web/lib/crypto.ts's algorithm (Node) with ENCRYPTION_KEY=test-encryption-key.
WEB_TOKEN = "v1.CdVhW3ASSzsjUQtl.DkCuNPmHf4U9tmzKbUoi5g.USqMBNk-GoiamD93rvYhJAdrbUKY0klpR55y"


def test_reads_tokens_encrypted_by_the_web_app():
    assert decrypt(WEB_TOKEN) == "ya29.refresh-token-from-web"
    sealed = encrypt("secret")
    assert sealed.startswith("v1.") and decrypt(sealed) == "secret"


async def _booked(client, biz):
    await client.post("/v1/services/defaults", headers=biz.dashboard_headers())
    res = await client.get("/v1/services", headers=biz.dashboard_headers())
    service_id = next(s["id"] for s in res.json() if s["name"] == "System estimate")
    res = await client.post(
        "/v1/bookings",
        json={
            "service_id": service_id, "start": f"{next_weekday(biz.tz).isoformat()}T10:00:00-04:00",
            "customer": {"name": "Jane Doe", "phone": "2125550123"}, "override_rules": True,
        },
        headers=biz.dashboard_headers(),
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_one_business_cannot_see_another(client, factory):
    a = await factory.business()
    b = await factory.business()
    await factory.staff(a, "Mike Ross")
    booking = await _booked(client, a)

    assert (await client.get(f"/v1/bookings/{booking['id']}", headers=b.dashboard_headers())).status_code == 404
    res = await client.post(f"/v1/bookings/{booking['id']}/cancel", json={}, headers=b.dashboard_headers())
    assert res.status_code == 404
    res = await client.post("/agent/cancel_appointment", json={"booking_id": booking["id"], "idempotency_key": "x"}, headers=b.agent_headers)
    assert res.status_code == 404
    res = await client.post("/agent/find_appointments", json={"phone": "2125550123"}, headers=b.agent_headers)
    assert res.json()["appointments"] == []
    assert (await client.get(f"/v1/bookings/{booking['id']}", headers=a.dashboard_headers())).status_code == 200


async def test_row_level_security_backs_up_missing_filters(client, factory):
    """Even a query with no business_id filter only sees the current tenant's rows."""
    a = await factory.business()
    b = await factory.business()
    await factory.staff(a, "Mike Ross")
    await factory.staff(b, "Anna Lee")
    async with tenant_session(b.id) as session:
        names = (await session.execute(text("SELECT name FROM sched.staff"))).scalars().all()
        assert names == ["Anna Lee"]
        # Writing a row for another tenant is refused too.
        try:
            async with session.begin_nested():
                await session.execute(text("INSERT INTO sched.staff (business_id, name) VALUES (:a, 'Intruder')"), {"a": a.id})
            raise AssertionError("insert for another tenant should fail")
        except Exception as e:  # noqa: BLE001
            assert "row-level security" in str(e)


async def test_dashboard_jwt_and_roles(client, factory):
    biz = await factory.business()
    settings = {"timezone": "America/Chicago", "vertical": "hvac"}
    assert (await client.get("/v1/settings")).status_code == 401
    expired = jwt.encode({"sub": "u", "bid": str(biz.id), "role": "owner", "aud": "sched", "exp": int(time.time()) - 5}, JWT_SECRET, "HS256")
    assert (await client.get("/v1/settings", headers={"authorization": f"Bearer {expired}"})).status_code == 401
    forged = jwt.encode({"sub": "u", "bid": str(biz.id), "role": "owner", "aud": "sched", "exp": int(time.time()) + 60}, "x" * 32, "HS256")
    assert (await client.get("/v1/settings", headers={"authorization": f"Bearer {forged}"})).status_code == 401
    # Members can read but not change settings.
    assert (await client.get("/v1/settings", headers=biz.dashboard_headers("member"))).status_code == 200
    assert (await client.put("/v1/settings", json=settings, headers=biz.dashboard_headers("member"))).status_code == 403
    res = await client.put("/v1/settings", json=settings, headers=biz.dashboard_headers("admin"))
    assert res.status_code == 200 and res.json()["labels"]["staff"] == "Technician"


async def test_viewing_a_job_is_audited(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross")
    booking = await _booked(client, biz)
    user = str(uuid.uuid4())
    await client.get(f"/v1/bookings/{booking['id']}", headers=biz.dashboard_headers(user_id=user))
    actor = await factory.scalar(
        "SELECT actor_id FROM sched.audit_log WHERE action = 'booking.view' AND entity_id = :i", i=booking["id"]
    )
    assert actor == user


async def test_api_connections_never_run_as_the_owner(client, factory):
    """Regression: a rolled-back first transaction must not drop the connection back to the owner role."""
    from app.db import sessionmaker

    biz = await factory.business()
    for _ in range(3):
        # Errors roll back their transaction; the next use of the same pooled connection must still be sched_app.
        await client.post("/agent/check_availability", json={"service": "nope"}, headers=biz.agent_headers)
    async with sessionmaker("app")() as session:
        for _ in range(5):
            async with session.begin():
                assert (await session.execute(text("SELECT current_user"))).scalar() == "sched_app"
                await session.rollback()
            async with session.begin():
                await session.execute(text("RESET ROLE"))
                assert (await session.execute(text("SELECT current_user"))).scalar() == "sched_app"
