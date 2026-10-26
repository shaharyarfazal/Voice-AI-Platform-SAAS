"""Phase 2: Google Calendar two-way sync, against an in-memory Google (tests/fake_google.py)."""

import asyncio
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from app.connectors import http as connector_http
from app.worker import tasks

from .conftest import INTERNAL_TOKEN, local, next_weekday
from .fake_google import FakeGoogle

REDIRECT = "https://app.test/api/schedule-oauth/google/callback"
INTERNAL = {"authorization": f"Bearer {INTERNAL_TOKEN}"}


@pytest.fixture
def google(monkeypatch):
    import httpx

    fake = FakeGoogle()
    monkeypatch.setattr(connector_http, "TRANSPORT", httpx.MockTransport(fake.handler))
    monkeypatch.setattr(connector_http, "BASE_DELAY", 0)
    return fake


async def connect(client, biz, staff_id, google, email, **account):
    google.account(email, **account)
    res = await client.post(
        "/v1/connections/google/authorize", json={"staff_id": str(staff_id), "redirect_uri": REDIRECT}, headers=biz.dashboard_headers()
    )
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    q = parse_qs(urlparse(url).query)
    assert q["access_type"] == ["offline"] and "https://www.googleapis.com/auth/calendar.events" in q["scope"][0]
    res = await client.post(
        "/connect/google/callback",
        json={"code": google.code_for(email), "state": q["state"][0], "nonce": res.json()["nonce"], "redirect_uri": REDIRECT},
        headers=INTERNAL,
    )
    assert res.status_code == 200, res.text
    return res.json()


async def notify(client, google, calendar, state="exists"):
    ch = google.channel_for(calendar)
    channel_id = next(k for k, v in google.channels.items() if v is ch)
    return await client.post(
        "/webhooks/google",
        headers={**INTERNAL, "x-goog-channel-id": channel_id, "x-goog-channel-token": ch["token"], "x-goog-resource-state": state},
    )


async def slots(client, biz, day):
    res = await client.post(
        "/agent/check_availability", json={"service": "AC repair", "date": day.isoformat(), "limit": 10}, headers=biz.agent_headers
    )
    assert res.status_code == 200, res.text
    return [s["slot_id"][11:] for s in res.json()["slots"]]


async def all_starts(client, biz, service_id, day):
    start = local(day, "00:00", biz.tz)
    res = await client.post(
        "/v1/availability",
        json={"service_id": str(service_id), "start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat()},
        headers=biz.dashboard_headers(),
    )
    return [datetime.fromisoformat(s["start"]).strftime("%H:%M") for s in res.json()["slots"]]


async def book(client, biz, slot_id, key="k1", phone="2125550100"):
    res = await client.post("/agent/hold_slot", json={"slot_id": slot_id, "service": "AC repair"}, headers=biz.agent_headers)
    assert res.status_code == 200, res.text
    return await client.post(
        "/agent/book_appointment",
        json={"hold_id": res.json()["hold_id"], "customer_name": "John Smith", "phone": phone,
              "address": {"line1": "12 Main St", "city": "Springfield", "postal_code": "10001"},
              "issue_description": "AC blowing warm air", "call_id": "room-1", "idempotency_key": key},
        headers=biz.agent_headers,
    )


async def setup(factory):
    biz = await factory.business()
    mike = await factory.staff(biz, "Mike Ross")
    service = await factory.service(biz, "AC repair", duration=60)
    return biz, mike, service


async def test_connect_imports_future_busy_time_and_subscribes(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    google.account(email, extra_calendars=[{"id": "family@group.test", "summary": "Family", "accessRole": "reader", "timeZone": "America/New_York"}])
    google.add_event(email, local(day, "10:00", biz.tz), local(day, "11:00", biz.tz))  # busy
    google.add_event(email, local(day, "13:00", biz.tz), local(day, "14:00", biz.tz), transparency="transparent")  # free
    google.add_event(email, local(day, "15:00", biz.tz), local(day, "16:00", biz.tz),
                     attendees=[{"email": email, "self": True, "responseStatus": "declined"}])  # declined
    google.add_event("family@group.test", local(day, "08:00", biz.tz), local(day, "09:00", biz.tz))  # not used for busy
    google.add_event(email, datetime.now(UTC) + timedelta(days=200), datetime.now(UTC) + timedelta(days=200, hours=1))

    result = await connect(client, biz, mike, google, email, extra_calendars=google.calendars[email][1:])
    assert result["email"] == email

    conns = (await client.get("/v1/connections", headers=biz.dashboard_headers())).json()
    [account] = conns["accounts"]
    assert account["status"] == "active" and account["provider"] == "google"
    primary = next(c for c in account["calendars"] if c["is_primary"])
    family = next(c for c in account["calendars"] if not c["is_primary"])
    assert primary["use_for_busy"] and primary["write_bookings_here"] and primary["notifications"]
    assert not family["use_for_busy"] and not family["writable"]
    # Tokens are stored encrypted.
    stored = await factory.scalar("SELECT access_token_enc FROM sched.connected_accounts")
    assert stored.startswith("v1.") and not any(t in stored for t in google.access)
    assert google.channel_for(email)["address"] == "https://app.test/api/schedule-webhooks/google"

    got = await all_starts(client, biz, service, day)
    assert "10:00" not in got and "09:30" not in got  # busy 10–11 blocks the 60-minute job overlapping it
    assert {"08:00", "13:00", "15:00"} <= set(got)  # family calendar, free and declined events don't block
    assert await factory.scalar("SELECT count(*) FROM sched.external_busy_blocks") == 1


async def test_webhook_brings_new_busy_time_in(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    google.add_event(email, local(day, "14:00", biz.tz), local(day, "15:00", biz.tz))
    assert "14:00" in await all_starts(client, biz, service, day)  # not known yet

    bad = await client.post("/webhooks/google", headers={**INTERNAL, "x-goog-channel-id": "nope", "x-goog-channel-token": "x", "x-goog-resource-state": "exists"})
    assert bad.status_code == 404
    assert (await client.post("/webhooks/google", headers={"x-goog-channel-id": "nope"})).status_code == 401
    assert (await notify(client, google, email, state="sync")).status_code == 200
    assert (await notify(client, google, email)).status_code == 200
    assert "14:00" not in await all_starts(client, biz, service, day)

    # Deleting it in Google frees the time again.
    event_id = next(e.id for e in google.live(email))
    google.delete_event(email, event_id)
    await notify(client, google, email)
    assert "14:00" in await all_starts(client, biz, service, day)


async def test_live_check_at_confirm_catches_what_the_cache_missed(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    google.add_event(email, local(day, "10:00", biz.tz), local(day, "11:00", biz.tz))  # no notification sent

    res = await book(client, biz, f"{day.isoformat()}T10:00")
    assert res.status_code == 409, res.text
    body = res.json()
    assert body["code"] == "slot_conflict" and body["alternatives"]
    assert await factory.scalar("SELECT status FROM sched.bookings") == "released"


async def test_job_is_written_to_the_calendar_and_kept_in_step(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)

    res = await book(client, biz, f"{day.isoformat()}T10:00")
    assert res.status_code == 200, res.text
    booking_id = res.json()["booking_id"]
    [event] = google.live(email)
    assert event.id == "sched" + booking_id.replace("-", "")
    assert event.body["summary"] == "HVAC: AC repair – John Smith"
    assert event.body["location"] == "12 Main St, Springfield, 10001"
    assert "+12125550100" in event.body["description"] and f"/schedule/jobs/{booking_id}" in event.body["description"]
    assert "transcript" in event.body["description"].lower() and "AC blowing warm air" in event.body["description"]
    assert event.body["extendedProperties"]["private"]["sched_booking_id"] == booking_id
    assert _ts(event.body["start"]) == local(day, "10:00", biz.tz)

    # Pushing again (retry) doesn't duplicate.
    await tasks.push_booking({"job_try": 1}, str(biz.id), booking_id, "create")
    assert len(google.live(email)) == 1

    # Our own write echoing back through a notification is not a change.
    await notify(client, google, email)
    assert await factory.scalar("SELECT external_change FROM sched.bookings WHERE id = :i", i=booking_id) is None
    # And our event doesn't block its own slot or count as external busy time.
    assert await factory.scalar("SELECT count(*) FROM sched.external_busy_blocks WHERE NOT is_ours") == 0

    res = await client.post(
        "/agent/reschedule_appointment", json={"booking_id": booking_id, "new_slot_id": f"{day.isoformat()}T10:30", "idempotency_key": "r1"},
        headers=biz.agent_headers,
    )
    assert res.status_code == 200, res.text  # live check ignores the job's own event at the old time
    [event] = google.live(email)
    assert _ts(event.body["start"]) == local(day, "10:30", biz.tz)

    detail = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()
    assert detail["sync"][0]["provider"] == "google" and detail["sync"][0]["account"] == email

    res = await client.post("/agent/cancel_appointment", json={"booking_id": booking_id, "idempotency_key": "c1"}, headers=biz.agent_headers)
    assert res.status_code == 200
    assert google.live(email) == []
    await notify(client, google, email)
    assert await factory.scalar("SELECT external_change FROM sched.bookings WHERE id = :i", i=booking_id) is None


def _ts(value):
    return datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))


async def test_changes_made_in_google_are_reflected_and_flagged(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    booking_id = (await book(client, biz, f"{day.isoformat()}T10:00")).json()["booking_id"]
    event_id = google.live(email)[0].id

    # The technician drags the job to 2 PM in Google Calendar.
    google.move_event(email, event_id, local(day, "14:00", biz.tz), local(day, "15:00", biz.tz))
    await notify(client, google, email)
    detail = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()
    assert detail["start"] == local(day, "14:00", biz.tz).astimezone(UTC).isoformat()
    assert detail["external_change"]["kind"] == "moved" and detail["external_change"]["applied"] is True
    assert "10:00" in await all_starts(client, biz, service, day) and "14:00" not in await all_starts(client, biz, service, day)

    res = await client.post(f"/v1/bookings/{booking_id}/external-change", json={"action": "keep"}, headers=biz.dashboard_headers())
    assert res.status_code == 200
    assert await factory.scalar("SELECT external_change FROM sched.bookings WHERE id = :i", i=booking_id) is None

    # Then deletes it in Google: the job stays (flagged for review), it isn't silently canceled.
    google.delete_event(email, event_id)
    await notify(client, google, email)
    detail = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()
    assert detail["status"] == "confirmed" and detail["external_change"]["kind"] == "deleted"
    # Reviewer puts it back on the calendar.
    res = await client.post(f"/v1/bookings/{booking_id}/external-change", json={"action": "restore"}, headers=biz.dashboard_headers())
    assert res.status_code == 200
    [event] = google.live(email)
    assert _ts(event.body["start"]) == local(day, "14:00", biz.tz)


async def test_move_onto_another_job_is_flagged_not_applied(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    first = (await book(client, biz, f"{day.isoformat()}T10:00", key="a")).json()["booking_id"]
    await book(client, biz, f"{day.isoformat()}T14:00", key="b", phone="2125550101")
    event_id = "sched" + first.replace("-", "")
    google.move_event(email, event_id, local(day, "14:00", biz.tz), local(day, "15:00", biz.tz))
    await notify(client, google, email)
    detail = (await client.get(f"/v1/bookings/{first}", headers=biz.dashboard_headers())).json()
    assert detail["start"] == local(day, "10:00", biz.tz).astimezone(UTC).isoformat()
    assert detail["external_change"]["applied"] is False


async def test_revoked_access_takes_only_that_technician_out(client, factory, google):
    biz, mike, service = await setup(factory)
    anna = await factory.staff(biz, "Anna Lee")
    day = next_weekday(biz.tz)
    await connect(client, biz, mike, google, "mike@acme.test")
    await connect(client, biz, anna, google, "anna@acme.test")
    google.revoke_account("mike@acme.test")
    await factory.execute("UPDATE sched.connected_accounts SET token_expires_at = now() WHERE external_email = 'mike@acme.test'")

    await tasks.refresh_tokens({})
    conns = (await client.get("/v1/connections", headers=biz.dashboard_headers())).json()
    statuses = {a["email"]: a["status"] for a in conns["accounts"]}
    assert statuses == {"mike@acme.test": "needs_reauth", "anna@acme.test": "active"}

    res = await client.post("/agent/hold_slot", json={"slot_id": f"{day.isoformat()}T10:00", "service": "AC repair"}, headers=biz.agent_headers)
    assert res.json()["technician_first_name"] == "Anna"
    res = await client.post("/agent/hold_slot", json={"slot_id": f"{day.isoformat()}T10:00", "service": "AC repair"}, headers=biz.agent_headers)
    assert res.status_code == 409  # Mike isn't offered while his calendar can't be read

    # With the business rule off, Mike stays bookable (on the information we have).
    await factory.execute("UPDATE sched.business_settings SET unavailable_on_reauth = false")
    res = await client.post("/agent/hold_slot", json={"slot_id": f"{day.isoformat()}T10:00", "service": "AC repair"}, headers=biz.agent_headers)
    assert res.json()["technician_first_name"] == "Mike"

    # Reconnecting restores it.
    await connect(client, biz, mike, google, "mike@acme.test")
    conns = (await client.get("/v1/connections", headers=biz.dashboard_headers())).json()
    assert {a["status"] for a in conns["accounts"]} == {"active"}


async def test_failed_write_goes_to_dead_letter_queue_and_can_be_retried(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    google.fail("POST www.googleapis.com/calendar/v3/calendars/", 503, times=50)
    res = await book(client, biz, f"{day.isoformat()}T10:00")
    assert res.status_code == 200  # the booking stands; the calendar write is retried separately
    booking_id = res.json()["booking_id"]
    detail = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()
    [failure] = detail["sync_failures"]
    assert failure["status"] == "dead" and "503" in failure["last_error"]
    assert detail["sync"] == []

    google.failures.clear()
    res = await client.post(f"/v1/sync-failures/{failure['id']}/retry", headers=biz.dashboard_headers())
    assert res.status_code == 200
    detail = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()
    assert detail["sync_failures"] == [] and len(detail["sync"]) == 1
    assert len(google.live(email)) == 1


async def test_transient_errors_are_retried_in_place(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    google.fail("POST www.googleapis.com/calendar/v3/calendars/", 429, times=2)
    res = await book(client, biz, f"{day.isoformat()}T10:00")
    assert res.status_code == 200 and len(google.live(email)) == 1


async def test_queued_push_retries_with_backoff_before_dead_letter(client, factory, google):
    from arq import Retry

    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    await connect(client, biz, mike, google, "mike@acme.test")
    google.fail("POST www.googleapis.com/calendar/v3/calendars/", 503, times=1000)
    booking_id = (await book(client, biz, f"{day.isoformat()}T10:00")).json()["booking_id"]
    await factory.execute("DELETE FROM sched.sync_failures")
    with pytest.raises(Retry):
        await tasks.push_booking({"job_try": 1}, str(biz.id), booking_id, "create")
    assert await factory.scalar("SELECT count(*) FROM sched.sync_failures") == 0
    await tasks.push_booking({"job_try": tasks.MAX_TRIES}, str(biz.id), booking_id, "create")
    assert await factory.scalar("SELECT status FROM sched.sync_failures") == "dead"


async def test_expired_sync_token_triggers_full_resync(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    google.add_event(email, local(day, "14:00", biz.tz), local(day, "15:00", biz.tz))
    google.token_floor = 10**9  # every token issued so far is now invalid
    await notify(client, google, email)
    assert "14:00" not in await all_starts(client, biz, service, day)


async def test_channels_are_renewed_before_they_expire(client, factory, google):
    biz, mike, service = await setup(factory)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    [old] = list(google.channels)
    assert await tasks.renew_channels({}) == 0  # a fresh week-long channel is left alone
    await factory.execute("UPDATE sched.sync_state SET channel_expires_at = now() + interval '2 hours'")
    assert await tasks.renew_channels({}) == 1
    assert old in google.stopped and len(google.channels) == 1 and old not in google.channels


async def test_disconnect_revokes_and_purges(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    google.add_event(email, local(day, "10:00", biz.tz), local(day, "11:00", biz.tz))
    await notify(client, google, email)
    account_id = (await client.get("/v1/connections", headers=biz.dashboard_headers())).json()["accounts"][0]["id"]

    assert (await client.delete(f"/v1/connections/{account_id}", headers=biz.dashboard_headers("member"))).status_code == 403
    assert (await client.delete(f"/v1/connections/{account_id}", headers=biz.dashboard_headers())).status_code == 204
    assert google.revoked and google.stopped and not google.channels
    for table in ("connected_accounts", "external_calendars", "external_busy_blocks", "sync_state"):
        assert await factory.scalar(f"SELECT count(*) FROM sched.{table}") == 0
    assert "10:00" in await all_starts(client, biz, service, day)


async def test_reassigning_a_job_moves_its_event_between_calendars(client, factory, google):
    biz, mike, service = await setup(factory)
    anna = await factory.staff(biz, "Anna Lee")
    day = next_weekday(biz.tz)
    await connect(client, biz, mike, google, "mike@acme.test")
    await connect(client, biz, anna, google, "anna@acme.test")
    res = await client.post(
        "/agent/hold_slot", json={"slot_id": f"{day.isoformat()}T10:00", "service": "AC repair", "technician": "Mike"}, headers=biz.agent_headers
    )
    res = await client.post(
        "/agent/book_appointment", json={"hold_id": res.json()["hold_id"], "customer_name": "Jo", "phone": "2125550100", "idempotency_key": "x"},
        headers=biz.agent_headers,
    )
    booking_id = res.json()["booking_id"]
    assert len(google.live("mike@acme.test")) == 1
    version = (await client.get(f"/v1/bookings/{booking_id}", headers=biz.dashboard_headers())).json()["version"]
    res = await client.patch(f"/v1/bookings/{booking_id}", json={"version": version, "staff_id": str(anna)}, headers=biz.dashboard_headers())
    assert res.status_code == 200, res.text
    assert google.live("mike@acme.test") == [] and len(google.live("anna@acme.test")) == 1
    # Mike's calendar reporting the deletion isn't mistaken for a change made in Google.
    await notify(client, google, "mike@acme.test")
    assert await factory.scalar("SELECT external_change FROM sched.bookings") is None


async def test_choose_a_different_bookings_calendar(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email, extra_calendars=[{"id": "jobs@group.test", "summary": "Jobs", "accessRole": "writer"}])
    booking_id = (await book(client, biz, f"{day.isoformat()}T10:00")).json()["booking_id"]
    cals = (await client.get("/v1/connections", headers=biz.dashboard_headers())).json()["accounts"][0]["calendars"]
    jobs = next(c for c in cals if c["name"] == "Jobs")
    res = await client.patch(f"/v1/connections/calendars/{jobs['id']}", json={"write_bookings_here": True}, headers=biz.dashboard_headers())
    assert res.status_code == 200
    assert google.live(email) == [] and len(google.live("jobs@group.test")) == 1
    assert booking_id


async def test_invite_link_and_oauth_state_checks(client, factory, google):
    biz, mike, service = await setup(factory)
    google.account("mike@acme.test")
    invite = (await client.post("/v1/connections/invite", json={"staff_id": str(mike), "provider": "google"}, headers=biz.dashboard_headers())).json()
    res = await client.post("/connect/google/authorize-invite", json={"invite": invite["token"], "redirect_uri": REDIRECT}, headers=INTERNAL)
    assert res.status_code == 200 and res.json()["staff_name"] == "Mike Ross"
    state = parse_qs(urlparse(res.json()["url"]).query)["state"][0]
    nonce = res.json()["nonce"]

    wrong_nonce = await client.post("/connect/google/callback", json={"code": google.code_for("mike@acme.test"), "state": state, "nonce": "x", "redirect_uri": REDIRECT}, headers=INTERNAL)
    assert wrong_nonce.status_code == 400
    tampered = await client.post("/connect/google/callback", json={"code": "c", "state": state[:-2] + "xx", "nonce": nonce, "redirect_uri": REDIRECT}, headers=INTERNAL)
    assert tampered.status_code == 400
    elsewhere = await client.post("/connect/google/callback", json={"code": "c", "state": state, "nonce": nonce, "redirect_uri": "https://evil.test/cb"}, headers=INTERNAL)
    assert elsewhere.status_code == 400
    ok = await client.post("/connect/google/callback", json={"code": google.code_for("mike@acme.test"), "state": state, "nonce": nonce, "redirect_uri": REDIRECT}, headers=INTERNAL)
    assert ok.status_code == 200 and ok.json()["via"] == "invite"
    assert (await client.post("/connect/google/authorize-invite", json={"invite": invite["token"] + "x", "redirect_uri": REDIRECT}, headers=INTERNAL)).status_code == 400


async def test_calendar_view_shows_busy_time_without_details(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    google.account(email)
    google.add_event(email, local(day, "10:00", biz.tz), local(day, "11:00", biz.tz), summary="Private appointment")
    await connect(client, biz, mike, google, email)
    start = local(day, "00:00", biz.tz)
    cal = (await client.get("/v1/calendar", params={"start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat()}, headers=biz.dashboard_headers())).json()
    [busy] = [e for e in cal["events"] if e["kind"] == "busy"]
    assert busy["title"] == "Busy (Google)" and "Private" not in str(cal)


async def test_concurrent_webhooks_for_one_calendar(client, factory, google):
    biz, mike, service = await setup(factory)
    day = next_weekday(biz.tz)
    email = "mike@acme.test"
    await connect(client, biz, mike, google, email)
    for h in (9, 11, 13):
        google.add_event(email, local(day, f"{h:02d}:00", biz.tz), local(day, f"{h:02d}:30", biz.tz))
    results = await asyncio.gather(*(notify(client, google, email) for _ in range(5)))
    assert all(r.status_code == 200 for r in results)
    assert await factory.scalar("SELECT count(*) FROM sched.external_busy_blocks WHERE NOT is_ours") == 3


def test_event_location_does_not_repeat_address_parts():
    from app.sync.push import _address_line

    assert _address_line({"line1": "12 Main St, Springfield 10001", "postal_code": "10001"}) == "12 Main St, Springfield 10001"
    assert _address_line({"line1": "12 Main St", "city": "Springfield", "postal_code": "10001"}) == "12 Main St, Springfield, 10001"
    assert _address_line({}) is None
