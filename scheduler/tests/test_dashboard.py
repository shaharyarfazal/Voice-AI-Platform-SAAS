"""Dashboard API: setup, manual booking, drag-to-reschedule, calendar feed."""

from datetime import timedelta

from .conftest import local, next_weekday


async def test_setup_and_calendar(client, factory):
    biz = await factory.business(vertical="generic")
    h = biz.dashboard_headers()
    res = await client.put(
        "/v1/settings",
        json={"timezone": "America/New_York", "vertical": "hvac", "service_area": {"postal_codes": ["10001"]}},
        headers=h,
    )
    assert res.json()["vertical"] == "hvac"
    added = (await client.post("/v1/services/defaults", headers=h)).json()
    assert {s["name"] for s in added} >= {"AC repair", "Furnace repair"}
    assert (await client.post("/v1/services/defaults", headers=h)).json() == []  # nothing new the second time

    tech = (await client.post("/v1/staff", json={"name": "Mike Ross", "phone": "212 555 0111", "skills": ["ac_repair"]}, headers=h)).json()
    assert tech["phone"] == "+12125550111"
    res = await client.put(
        f"/v1/staff/{tech['id']}/working-hours",
        json={"windows": [{"weekday": d, "start": "08:00", "end": "12:00"} for d in range(5)]
        + [{"weekday": d, "start": "13:00", "end": "17:00"} for d in range(5)]},
        headers=h,
    )
    assert len(res.json()["working_hours"]) == 10
    bad = await client.put(
        f"/v1/staff/{tech['id']}/working-hours",
        json={"windows": [{"weekday": 0, "start": "08:00", "end": "12:00"}, {"weekday": 0, "start": "11:00", "end": "14:00"}]},
        headers=h,
    )
    assert bad.status_code == 400 and bad.json()["code"] == "overlapping_hours"

    ac = next(s for s in added if s["name"] == "AC repair")
    day = next_weekday(biz.tz)
    # 12:00 falls in the lunch break: refused unless the owner overrides the rules.
    body = {
        "service_id": ac["id"], "start": local(day, "12:00", biz.tz).isoformat(),
        "customer": {"name": "Jane Doe", "phone": "2125550123"},
        "address": {"line1": "1 Elm St", "postal_code": "10001"}, "details": {"system_type": "furnace"},
    }
    assert (await client.post("/v1/bookings", json=body, headers=h)).status_code == 409
    booking = (await client.post("/v1/bookings", json={**body, "override_rules": True}, headers=h)).json()
    assert booking["status"] == "confirmed" and booking["source"] == "dashboard"
    assert booking["details"] == {"system_type": "furnace"} and booking["staff"]["name"] == "Mike Ross"

    invalid = await client.post("/v1/bookings", json={**body, "start": local(day, "14:00", biz.tz).isoformat(), "details": {"system_type": "rocket"}}, headers=h)
    assert invalid.status_code == 400 and invalid.json()["code"] == "invalid_details"

    start = local(day, "00:00", biz.tz)
    cal = (await client.get("/v1/calendar", params={"start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat()}, headers=h)).json()
    assert cal["timezone"] == "America/New_York" and [s["name"] for s in cal["staff"]] == ["Mike Ross"]
    assert [e["id"] for e in cal["events"]] == [booking["id"]]
    assert cal["events"][0]["customer_name"] == "Jane Doe" and not cal["events"][0]["rescheduled"]


async def test_drag_to_reschedule_and_version_conflict(client, factory):
    biz = await factory.business()
    mike = await factory.staff(biz, "Mike Ross")
    anna = await factory.staff(biz, "Anna Lee")
    service = await factory.service(biz, "AC repair", duration=60)
    h = biz.dashboard_headers()
    day = next_weekday(biz.tz)
    booking = (
        await client.post(
            "/v1/bookings",
            json={"service_id": str(service), "staff_id": str(mike), "start": local(day, "09:00", biz.tz).isoformat(),
                  "customer": {"name": "Jane Doe", "phone": "2125550123"}},
            headers=h,
        )
    ).json()
    moved = await client.patch(
        f"/v1/bookings/{booking['id']}",
        json={"version": booking["version"], "start": local(day, "14:00", biz.tz).isoformat(), "staff_id": str(anna)},
        headers=h,
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["staff"]["name"] == "Anna Lee" and moved.json()["start"].startswith(f"{day.isoformat()}T18:00")
    assert moved.json()["history"][-1]["kind"] == "rescheduled"

    stale = await client.patch(f"/v1/bookings/{booking['id']}", json={"version": booking["version"], "notes": "x"}, headers=h)
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"

    # Dragging onto another job of the same technician is refused by the engine.
    other = (
        await client.post(
            "/v1/bookings",
            json={"service_id": str(service), "staff_id": str(anna), "start": local(day, "10:00", biz.tz).isoformat(),
                  "customer": {"name": "Bob", "phone": "2125550124"}},
            headers=h,
        )
    ).json()
    clash = await client.patch(
        f"/v1/bookings/{other['id']}", json={"version": other["version"], "start": local(day, "14:30", biz.tz).isoformat()}, headers=h
    )
    assert clash.status_code == 409

    done = await client.post(f"/v1/bookings/{booking['id']}/complete", headers=h)
    assert done.json()["status"] == "completed"
    canceled = await client.post(f"/v1/bookings/{other['id']}/cancel", json={"reason": "customer called"}, headers=h)
    assert canceled.json()["status"] == "canceled" and canceled.json()["cancel_reason"] == "customer called"


async def test_time_off_crud_and_customer_search(client, factory):
    biz = await factory.business()
    mike = await factory.staff(biz, "Mike Ross")
    h = biz.dashboard_headers()
    day = next_weekday(biz.tz)
    off = await client.post(
        f"/v1/staff/{mike}/time-off",
        json={"start": local(day, "08:00", biz.tz).isoformat(), "end": local(day, "17:00", biz.tz).isoformat(), "reason": "Training"},
        headers=h,
    )
    assert off.status_code == 201
    assert len((await client.get(f"/v1/staff/{mike}/time-off", headers=h)).json()) == 1
    assert (await client.delete(f"/v1/staff/{mike}/time-off/{off.json()['id']}", headers=h)).status_code == 204
    assert (await client.get("/v1/customers", params={"q": "555"}, headers=h)).json() == []


async def test_no_qualified_staff_is_reported_as_such(client, factory):
    biz = await factory.business()
    await factory.staff(biz, "Mike Ross", skills=["ac_repair"])
    install = await factory.service(biz, "AC installation", duration=240, skills=["ac_install"])
    res = await client.post(
        "/v1/bookings",
        json={"service_id": str(install), "start": local(next_weekday(biz.tz), "09:00", biz.tz).isoformat(),
              "customer": {"name": "Jane", "phone": "2125550123"}},
        headers=biz.dashboard_headers(),
    )
    assert res.status_code == 409 and res.json()["code"] == "no_qualified_staff"
