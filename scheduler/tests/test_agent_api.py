"""The voice agent's tool API, end to end."""

from datetime import timedelta

from .conftest import local, next_weekday


async def setup(factory, **settings):
    biz = await factory.business(**settings)
    mike = await factory.staff(biz, "Mike Ross", skills=["ac_repair"])
    await factory.service(biz, "AC repair", duration=90, before=15, after=15, skills=["ac_repair"])
    return biz, mike


async def book(client, biz, slot_id, key="call-1-book", phone="(212) 555-0100", **extra):
    res = await client.post(
        "/agent/hold_slot", json={"slot_id": slot_id, "service": "ac repair", "address": "12 Main St, Springfield 10001"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text
    hold = res.json()
    res = await client.post(
        "/agent/book_appointment",
        json={
            "hold_id": hold["hold_id"], "customer_name": "John Smith", "phone": phone,
            "address": {"line1": "12 Main St", "city": "Springfield", "postal_code": "10001"},
            "issue_description": "AC blowing warm air", "urgency": "standard", "call_id": "room-123",
            "idempotency_key": key, "details": {"system_type": "central_ac", "no_cooling": True}, **extra,
        },
        headers=biz.agent_headers,
    )
    return hold, res


async def test_check_hold_book_flow(client, factory):
    biz, _ = await setup(factory)
    day = next_weekday(biz.tz)
    res = await client.post(
        "/agent/check_availability",
        json={"service": "AC Repair", "date": day.isoformat(), "time_window": "morning", "address": "12 Main St 10001"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] and body["service"]["name"] == "AC repair" and body["timezone"] == "America/New_York"
    assert body["slots"] and all(s["slot_id"].startswith(day.isoformat()) for s in body["slots"])
    assert all(int(s["slot_id"][11:13]) < 12 for s in body["slots"])  # morning only
    assert body["message"].startswith("Open times")

    slot = body["slots"][0]["slot_id"]
    hold, res = await book(client, biz, slot)
    assert hold["technician_first_name"] == "Mike" and hold["expires_in_sec"] == 180
    assert res.status_code == 200, res.text
    booked = res.json()
    assert booked["ok"] and len(booked["confirmation_code"]) == 6
    assert booked["technician_first_name"] == "Mike"
    assert booked["time_window"].startswith("between 8:00 and 9:30")
    assert "confirmation code" in booked["message"]

    # The booked time is gone from availability.
    res = await client.post(
        "/agent/check_availability", json={"service": "AC repair", "date": day.isoformat(), "limit": 10}, headers=biz.agent_headers
    )
    assert slot not in [s["slot_id"] for s in res.json()["slots"]]

    # Customer, address and vertical details were stored.
    assert await factory.scalar("SELECT phone_e164 FROM sched.customers WHERE business_id = :b", b=biz.id) == "+12125550100"
    assert await factory.scalar("SELECT details->>'system_type' FROM sched.bookings WHERE id = :i", i=booked["booking_id"]) == "central_ac"


async def test_book_is_idempotent(client, factory):
    biz, _ = await setup(factory)
    slot = f"{next_weekday(biz.tz).isoformat()}T10:00"
    hold, first = await book(client, biz, slot)
    assert first.status_code == 200
    retry = await client.post(
        "/agent/book_appointment",
        json={
            "hold_id": hold["hold_id"], "customer_name": "John Smith", "phone": "(212) 555-0100",
            "address": {"line1": "12 Main St", "city": "Springfield", "postal_code": "10001"},
            "issue_description": "AC blowing warm air", "urgency": "standard", "call_id": "room-123",
            "idempotency_key": "call-1-book", "details": {"system_type": "central_ac", "no_cooling": True},
        },
        headers=biz.agent_headers,
    )
    assert retry.status_code == 200 and retry.json() == first.json()
    assert await factory.scalar("SELECT count(*) FROM sched.bookings WHERE status = 'confirmed'") == 1

    # Same key, different request: refused rather than silently returning the old booking.
    mismatch = await client.post(
        "/agent/book_appointment",
        json={"hold_id": hold["hold_id"], "customer_name": "Someone Else", "phone": "2125550199", "idempotency_key": "call-1-book"},
        headers=biz.agent_headers,
    )
    assert mismatch.status_code == 409 and mismatch.json()["code"] == "idempotency_mismatch"


async def test_unknown_service_out_of_area_and_bad_phone(client, factory):
    biz, _ = await setup(factory, service_area={"postal_codes": ["10001", "10002"]})
    res = await client.post("/agent/check_availability", json={"service": "pool cleaning"}, headers=biz.agent_headers)
    assert res.status_code == 400 and res.json()["code"] == "unknown_service" and "AC repair" in res.json()["message"]
    res = await client.post(
        "/agent/check_availability", json={"service": "AC repair", "postal_code": "90210"}, headers=biz.agent_headers
    )
    assert res.json()["code"] == "out_of_area"
    _, res = await book(client, biz, f"{next_weekday(biz.tz).isoformat()}T10:00", phone="123")
    assert res.status_code == 400 and res.json()["code"] == "invalid_phone"


async def test_taken_slot_returns_alternatives(client, factory):
    biz, _ = await setup(factory)
    slot = f"{next_weekday(biz.tz).isoformat()}T10:00"
    _, res = await book(client, biz, slot)
    assert res.status_code == 200
    res = await client.post("/agent/hold_slot", json={"slot_id": slot, "service": "AC repair"}, headers=biz.agent_headers)
    assert res.status_code == 409
    body = res.json()
    assert body["code"] == "slot_unavailable" and len(body["alternatives"]) == 3
    assert slot not in [a["slot_id"] for a in body["alternatives"]]


async def test_lapsed_hold_is_reheld_at_confirm(client, factory):
    biz, mike = await setup(factory)
    slot = f"{next_weekday(biz.tz).isoformat()}T10:00"
    res = await client.post("/agent/hold_slot", json={"slot_id": slot, "service": "AC repair"}, headers=biz.agent_headers)
    hold_id = res.json()["hold_id"]
    await factory.execute("UPDATE sched.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :i", i=hold_id)
    res = await client.post(
        "/agent/book_appointment",
        json={"hold_id": hold_id, "customer_name": "John Smith", "phone": "2125550100", "idempotency_key": "k1"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["booking_id"] != hold_id  # a fresh hold was taken and confirmed
    assert await factory.scalar("SELECT status FROM sched.bookings WHERE id = :i", i=hold_id) == "expired"


async def test_lapsed_hold_taken_by_someone_else(client, factory):
    biz, _ = await setup(factory)
    slot = f"{next_weekday(biz.tz).isoformat()}T10:00"
    res = await client.post("/agent/hold_slot", json={"slot_id": slot, "service": "AC repair"}, headers=biz.agent_headers)
    hold_id = res.json()["hold_id"]
    await factory.execute("UPDATE sched.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :i", i=hold_id)
    _, other = await book(client, biz, slot, key="other-caller")  # second caller takes the time
    assert other.status_code == 200
    res = await client.post(
        "/agent/book_appointment",
        json={"hold_id": hold_id, "customer_name": "John Smith", "phone": "2125550100", "idempotency_key": "k1"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 409 and res.json()["code"] == "hold_expired" and res.json()["alternatives"]


async def test_find_reschedule_cancel_by_phone(client, factory):
    biz, mike = await setup(factory)
    day = next_weekday(biz.tz)
    _, res = await book(client, biz, f"{day.isoformat()}T10:00")
    booking_id = res.json()["booking_id"]

    res = await client.post("/agent/find_appointments", json={"phone": "+1 212-555-0100"}, headers=biz.agent_headers)
    found = res.json()
    assert len(found["appointments"]) == 1 and found["appointments"][0]["technician_first_name"] == "Mike"

    new_slot = f"{day.isoformat()}T13:00"
    res = await client.post(
        "/agent/reschedule_appointment",
        json={"phone": "2125550100", "new_slot_id": new_slot, "idempotency_key": "resched-1"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["booking_id"] == booking_id and res.json()["message"].startswith("Moved")
    assert res.json()["start"].startswith(f"{day.isoformat()}T13:00")
    kinds = await factory.scalar(
        "SELECT array_agg(kind ORDER BY id) FROM sched.booking_events WHERE booking_id = :i", i=booking_id
    )
    assert kinds == ["held", "confirmed", "rescheduled"]

    # Moving onto its own old time range (overlapping itself) is fine: it doesn't block itself.
    res = await client.post(
        "/agent/reschedule_appointment",
        json={"booking_id": booking_id, "new_slot_id": f"{day.isoformat()}T13:30", "idempotency_key": "resched-2"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text

    res = await client.post(
        "/agent/cancel_appointment",
        json={"phone": "2125550100", "date": day.isoformat(), "reason": "fixed itself", "idempotency_key": "cancel-1"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200 and res.json()["status"] == "canceled"
    res = await client.post("/agent/find_appointments", json={"phone": "2125550100"}, headers=biz.agent_headers)
    assert res.json()["appointments"] == []


async def test_requested_technician(client, factory):
    biz, mike = await setup(factory)
    await factory.staff(biz, "Anna Lee", skills=["ac_repair"])
    day = next_weekday(biz.tz)
    res = await client.post(
        "/agent/hold_slot",
        json={"slot_id": f"{day.isoformat()}T10:00", "service": "AC repair", "technician": "anna"},
        headers=biz.agent_headers,
    )
    assert res.json()["technician_first_name"] == "Anna"
    res = await client.post(
        "/agent/check_availability", json={"service": "AC repair", "technician": "Bob"}, headers=biz.agent_headers
    )
    assert res.json()["code"] == "unknown_technician"


async def test_auth(client, factory):
    biz, _ = await setup(factory)
    body = {"service": "AC repair"}
    assert (await client.post("/agent/check_availability", json=body)).status_code == 401
    assert (
        await client.post("/agent/check_availability", json=body, headers={"authorization": "Bearer wrong"})
    ).status_code == 401
    # Internal token without an agent id isn't enough.
    res = await client.post("/agent/check_availability", json=body, headers={"authorization": "Bearer test-internal-token"})
    assert res.status_code == 401
    # A workspace API key works for third-party agents.
    res = await client.post("/agent/check_availability", json=body, headers={"authorization": f"Bearer {biz.api_key}"})
    assert res.status_code == 200, res.text
    # A suspended workspace is locked out.
    await factory.execute("UPDATE public.tenants SET status = 'suspended' WHERE id = :b", b=biz.id)
    res = await client.post("/agent/check_availability", json=body, headers={"authorization": f"Bearer {biz.api_key}"})
    assert res.status_code == 401


async def test_not_configured(client, factory):
    biz, _ = await setup(factory)
    await factory.execute("DELETE FROM sched.business_settings WHERE business_id = :b", b=biz.id)
    res = await client.post("/agent/check_availability", json={"service": "AC repair"}, headers=biz.agent_headers)
    assert res.status_code == 409 and res.json()["code"] == "not_configured"


async def test_call_artifacts_attach_to_jobs(client, factory):
    biz, _ = await setup(factory)
    _, res = await book(client, biz, f"{next_weekday(biz.tz).isoformat()}T10:00")
    booking_id = res.json()["booking_id"]
    res = await client.post(
        "/calls/room-123/artifacts",
        json={"recording_url": "https://media.example.com/rec.mp3", "transcript": "Agent: Hi\nCaller: My AC is broken",
              "summary": {"issue": "AC broken"}},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200 and res.json()["bookings_linked"] == 1
    # Multipart with an audio file is stored privately and served through a signed link.
    res = await client.post(
        "/calls/room-123/artifacts",
        files={"recording": ("call.mp3", b"ID3fake-mp3", "audio/mpeg")},
        data={"transcript": "updated transcript"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text
    detail = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()
    artifacts = detail["call_artifacts"]
    assert artifacts["transcript"] == "updated transcript" and artifacts["summary"] == {"issue": "AC broken"}
    assert artifacts["recording_url"].startswith("/files/")
    audio = await client.get(artifacts["recording_url"])
    assert audio.status_code == 200 and audio.content == b"ID3fake-mp3"
    tampered = artifacts["recording_url"].replace("sig=", "sig=0")
    assert (await client.get(tampered)).status_code == 403


async def test_no_availability(client, factory):
    biz = await factory.business()
    await factory.service(biz, "AC repair")
    res = await client.post("/agent/check_availability", json={"service": "AC repair"}, headers=biz.agent_headers)
    assert res.status_code == 400 and res.json()["code"] == "no_availability"


async def test_next_openings_when_requested_day_is_full(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross", hours=[(d, "08:00", "17:00") for d in (1, 2)])  # Tue, Wed
    await factory.service(biz, "AC repair", duration=60)
    monday = next_weekday(biz.tz, weekday=0)
    res = await client.post(
        "/agent/check_availability", json={"service": "AC repair", "date": monday.isoformat()}, headers=biz.agent_headers
    )
    body = res.json()
    assert body["message"].startswith("Nothing is open on")
    assert all(s["slot_id"].startswith((monday + timedelta(days=1)).isoformat()) for s in body["slots"])
