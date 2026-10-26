"""An in-memory Google (OAuth + Calendar API v3), served through httpx.MockTransport. Enough of the
real behaviour to test sync honestly: etags, sync tokens that can expire (410), cancelled events in
incremental results, client-supplied event ids (409 on reuse), free/busy, watch channels."""

from __future__ import annotations

import base64
import itertools
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, unquote

import httpx

SCOPE = (
    "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events "
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.freebusy"
)


def _ts(value: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))


@dataclass
class Event:
    id: str
    calendar: str
    body: dict[str, Any]
    seq: int
    etag: str
    status: str = "confirmed"


@dataclass
class FakeGoogle:
    calendars: dict[str, list[dict[str, Any]]] = field(default_factory=dict)  # email → calendarList items
    events: dict[str, dict[str, Event]] = field(default_factory=dict)  # calendar id → events
    access: dict[str, str] = field(default_factory=dict)  # access token → email
    refresh: dict[str, str] = field(default_factory=dict)  # refresh token → email
    codes: dict[str, str] = field(default_factory=dict)
    channels: dict[str, dict[str, Any]] = field(default_factory=dict)
    stopped: list[str] = field(default_factory=list)
    revoked: list[str] = field(default_factory=list)
    requests: list[tuple[str, str]] = field(default_factory=list)
    failures: list[tuple[str, int, int]] = field(default_factory=list)  # (method+path prefix, status, remaining)
    token_floor: int = 0  # sync tokens below this are expired (410)
    _seq: itertools.count = field(default_factory=lambda: itertools.count(1))

    # ── test controls ──────────────────────────────────────────────────────

    def account(self, email: str, *, extra_calendars: list[dict[str, Any]] | None = None) -> str:
        primary = {"id": email, "summary": email, "primary": True, "accessRole": "owner", "timeZone": "America/New_York"}
        self.calendars[email] = [primary, *(extra_calendars or [])]
        for c in self.calendars[email]:
            self.events.setdefault(c["id"], {})
        return email

    def code_for(self, email: str) -> str:
        code = f"code-{uuid.uuid4().hex[:8]}"
        self.codes[code] = email
        return code

    def add_event(self, calendar: str, start: datetime, end: datetime, **extra: Any) -> str:
        event_id = extra.pop("id", None) or uuid.uuid4().hex
        body = {"id": event_id, "summary": "Dentist", "start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()}, **extra}
        self._store(calendar, event_id, body)
        return event_id

    def move_event(self, calendar: str, event_id: str, start: datetime, end: datetime) -> None:
        body = dict(self.events[calendar][event_id].body)
        body["start"], body["end"] = {"dateTime": start.isoformat()}, {"dateTime": end.isoformat()}
        self._store(calendar, event_id, body)

    def delete_event(self, calendar: str, event_id: str) -> None:
        e = self.events[calendar][event_id]
        self._store(calendar, event_id, e.body, status="cancelled")

    def revoke_account(self, email: str) -> None:
        for table in (self.access, self.refresh):
            for token, owner in list(table.items()):
                if owner == email:
                    del table[token]

    def fail(self, prefix: str, status: int, times: int) -> None:
        self.failures.append((prefix, status, times))

    def live(self, calendar: str) -> list[Event]:
        return [e for e in self.events.get(calendar, {}).values() if e.status != "cancelled"]

    def channel_for(self, calendar: str) -> dict[str, Any]:
        return next(c for c in self.channels.values() if c["calendar"] == calendar)

    # ── internals ──────────────────────────────────────────────────────────

    def _store(self, calendar: str, event_id: str, body: dict[str, Any], status: str = "confirmed") -> Event:
        seq = next(self._seq)
        event = Event(id=event_id, calendar=calendar, body={**body, "id": event_id}, seq=seq, etag=f'"{seq}"', status=status)
        self.events.setdefault(calendar, {})[event_id] = event
        return event

    def _render(self, e: Event) -> dict[str, Any]:
        return {**e.body, "etag": e.etag, "status": e.status}

    def _email(self, request: httpx.Request) -> str | None:
        auth = request.headers.get("authorization", "")
        return self.access.get(auth.removeprefix("Bearer "))

    def _issue(self, email: str, with_refresh: bool) -> dict[str, Any]:
        access = f"ya29.{uuid.uuid4().hex}"
        self.access[access] = email
        claims = base64.urlsafe_b64encode(json.dumps({"email": email, "sub": email}).encode()).decode().rstrip("=")
        body: dict[str, Any] = {"access_token": access, "expires_in": 3599, "scope": SCOPE, "token_type": "Bearer", "id_token": f"h.{claims}.s"}
        if with_refresh:
            refresh = f"1//{uuid.uuid4().hex}"
            self.refresh[refresh] = email
            body["refresh_token"] = refresh
        return body

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = unquote(request.url.path)
        key = f"{request.method} {request.url.host}{path}"
        self.requests.append((request.method, f"{request.url.host}{path}"))
        for i, (prefix, status, remaining) in enumerate(self.failures):
            if remaining > 0 and key.startswith(prefix):
                self.failures[i] = (prefix, status, remaining - 1)
                return httpx.Response(status, json={"error": {"message": "injected", "errors": [{"reason": "backendError"}]}})

        if request.url.host == "oauth2.googleapis.com" or path in ("/token", "/revoke"):
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            if path == "/token" and form.get("grant_type") == "authorization_code":
                email = self.codes.pop(form.get("code", ""), None)
                if not email:
                    return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Bad code"})
                return httpx.Response(200, json=self._issue(email, with_refresh=True))
            if path == "/token" and form.get("grant_type") == "refresh_token":
                email = self.refresh.get(form.get("refresh_token", ""))
                if not email:
                    return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
                return httpx.Response(200, json=self._issue(email, with_refresh=False))
            if path == "/revoke":
                self.revoked.append(form.get("token", ""))
                self.access.pop(form.get("token", ""), None)
                self.refresh.pop(form.get("token", ""), None)
                return httpx.Response(200)
            return httpx.Response(404)

        email = self._email(request)
        if email is None:
            return httpx.Response(401, json={"error": {"message": "Invalid Credentials", "errors": [{"reason": "authError"}]}})
        api = path.removeprefix("/calendar/v3")
        if api == "/users/me/calendarList" and request.method == "GET":
            return httpx.Response(200, json={"items": self.calendars.get(email, [])})
        if api == "/freeBusy":
            body = json.loads(request.content)
            t0, t1 = _ts({"dateTime": body["timeMin"]}), _ts({"dateTime": body["timeMax"]})
            out = {}
            for item in body["items"]:
                busy = [
                    {"start": e.body["start"]["dateTime"], "end": e.body["end"]["dateTime"]}
                    for e in self.live(item["id"])
                    if e.body.get("transparency") != "transparent" and _ts(e.body["start"]) < t1 and _ts(e.body["end"]) > t0
                ]
                out[item["id"]] = {"busy": busy}
            return httpx.Response(200, json={"calendars": out})
        if api == "/channels/stop":
            body = json.loads(request.content)
            self.channels.pop(body["id"], None)
            self.stopped.append(body["id"])
            return httpx.Response(204)
        if api.startswith("/calendars/"):
            rest = api.removeprefix("/calendars/")
            calendar, _, tail = rest.partition("/")
            events = self.events.setdefault(calendar, {})
            if tail == "events/watch":
                body = json.loads(request.content)
                self.channels[body["id"]] = {"calendar": calendar, "token": body["token"], "address": body["address"], "resourceId": f"res-{calendar}"}
                expiration = int(datetime.now(UTC).timestamp() * 1000) + int(body["params"]["ttl"]) * 1000
                return httpx.Response(200, json={"id": body["id"], "resourceId": f"res-{calendar}", "expiration": str(expiration)})
            if tail == "events" and request.method == "POST":
                body = json.loads(request.content)
                if body["id"] in events:
                    return httpx.Response(409, json={"error": {"message": "The requested identifier already exists.", "errors": [{"reason": "duplicate"}]}})
                return httpx.Response(200, json=self._render(self._store(calendar, body["id"], body)))
            if tail == "events" and request.method == "GET":
                return self._list(calendar, request)
            if tail.startswith("events/"):
                event_id = tail.removeprefix("events/")
                if event_id not in events:
                    return httpx.Response(404, json={"error": {"message": "Not Found"}})
                if request.method == "PUT":
                    body = json.loads(request.content)
                    return httpx.Response(200, json=self._render(self._store(calendar, event_id, body, status=body.get("status", "confirmed"))))
                if request.method == "DELETE":
                    if events[event_id].status == "cancelled":
                        return httpx.Response(410, json={"error": {"message": "Resource has been deleted"}})
                    self.delete_event(calendar, event_id)
                    return httpx.Response(204)
        return httpx.Response(404, json={"error": {"message": f"no fake for {key}"}})

    def _list(self, calendar: str, request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        current = next(self._seq)
        if "syncToken" in params:
            since = int(params["syncToken"])
            if since < self.token_floor:
                return httpx.Response(410, json={"error": {"message": "Sync token is no longer valid", "errors": [{"reason": "fullSyncRequired"}]}})
            items = [self._render(e) for e in self.events[calendar].values() if e.seq > since]
        else:
            t0, t1 = _ts({"dateTime": params["timeMin"]}), _ts({"dateTime": params["timeMax"]})
            items = [
                self._render(e) for e in self.live(calendar)
                if _ts(e.body["start"]) < t1 and _ts(e.body["end"]) > t0
            ]
        return httpx.Response(200, json={"items": items, "nextSyncToken": str(current)})
