"""Google Calendar API v3.

Scopes are the narrowest that do the job: calendar.events (read/write events, watch, sync tokens),
calendar.calendarlist.readonly (list the person's calendars), calendar.freebusy (live availability),
plus openid/email to know which account was connected.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..config import get_settings
from . import http
from .base import (
    BusyInterval,
    CalendarConnector,
    ConnectorError,
    EventPayload,
    EventRef,
    ExternalCalendar,
    OAuthTokens,
    Subscription,
    SyncChanges,
    register,
)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/calendar/v3"
if _test_base := get_settings().google_test_base_url.rstrip("/"):
    AUTH_URL, TOKEN_URL, REVOKE_URL, API = (
        f"{_test_base}/o/oauth2/v2/auth", f"{_test_base}/token", f"{_test_base}/revoke", f"{_test_base}/calendar/v3"
    )
SCOPES = (
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.freebusy",
)
# Our booking id, stored on every event we write (private extended property): how we recognise our
# own events, and our own writes echoing back through webhooks.
BOOKING_PROPERTY = "sched_booking_id"
CHANNEL_TTL = timedelta(days=7)


def event_id_for(booking_id: str) -> str:
    """Deterministic event id (base32hex: 0-9a-v), so creating the same booking's event twice can't
    make two events."""
    return "sched" + uuid.UUID(booking_id).hex


def _cal(calendar_id: str) -> str:
    return quote(calendar_id, safe="")


def _parse_time(value: dict[str, Any], tz: ZoneInfo) -> datetime:
    if "dateTime" in value:
        return datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00")).astimezone(UTC)
    # All-day events: whole days on the calendar's clock.
    d = date.fromisoformat(value["date"])
    return datetime(d.year, d.month, d.day, tzinfo=tz).astimezone(UTC)


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _rfc3339(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _is_busy(event: dict[str, Any]) -> bool:
    if event.get("status") == "cancelled" or event.get("transparency") == "transparent":
        return False
    for attendee in event.get("attendees") or []:
        if attendee.get("self") and attendee.get("responseStatus") == "declined":
            return False
    return True


def _email_from_id_token(id_token: str | None) -> tuple[str | None, str | None]:
    if not id_token:
        return None, None
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return claims.get("email"), claims.get("sub")
    except (IndexError, ValueError):
        return None, None


@register
class GoogleConnector(CalendarConnector):
    provider = "google"

    def __init__(self) -> None:
        settings = get_settings()
        self.client_id = settings.google_client_id
        self.client_secret = settings.google_client_secret

    def get_oauth_url(self, state: str, redirect_uri: str) -> str:
        if not self.client_id:
            raise ConnectorError("Google isn't configured (GOOGLE_CLIENT_ID)", retryable=False)
        return f"{AUTH_URL}?" + urlencode(
            {
                "client_id": self.client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": " ".join(SCOPES),
                # Offline access gives a refresh token; consent makes Google send it again on reconnect.
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "state": state,
            }
        )

    def _tokens(self, body: dict[str, Any], previous_refresh: str | None = None, email: str | None = None) -> OAuthTokens:
        token_email, _ = _email_from_id_token(body.get("id_token"))
        return OAuthTokens(
            access_token=body["access_token"],
            refresh_token=body.get("refresh_token") or previous_refresh,
            expires_at=datetime.now(UTC) + timedelta(seconds=int(body.get("expires_in", 3600))),
            scopes=tuple(str(body.get("scope", "")).split()),
            account_email=token_email or email or "",
        )

    async def handle_oauth_callback(self, code: str, redirect_uri: str) -> OAuthTokens:
        res = await http.request(
            "POST", TOKEN_URL, provider="google", attempts=2,
            data={
                "code": code, "client_id": self.client_id, "client_secret": self.client_secret,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code",
            },
        )
        tokens = self._tokens(res.json())
        if not tokens.refresh_token:
            raise ConnectorError("Google didn't grant offline access; try connecting again.", retryable=False)
        missing = {"https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"} - set(tokens.scopes)
        if missing:
            raise ConnectorError(
                "Calendar access wasn't granted. Connect again and leave the calendar boxes ticked.", retryable=False
            )
        return tokens

    async def refresh_token(self, refresh_token: str) -> OAuthTokens:
        res = await http.request(
            "POST", TOKEN_URL, provider="google",
            data={
                "refresh_token": refresh_token, "client_id": self.client_id, "client_secret": self.client_secret,
                "grant_type": "refresh_token",
            },
        )
        return self._tokens(res.json(), previous_refresh=refresh_token)

    async def revoke(self, token: str) -> None:
        try:
            await http.request("POST", REVOKE_URL, provider="google", attempts=2, data={"token": token})
        except ConnectorError as e:
            # Already revoked or expired: nothing left to revoke.
            if e.status not in (400, 401):
                raise

    async def list_calendars(self, access_token: str) -> list[ExternalCalendar]:
        out: list[ExternalCalendar] = []
        page_token = None
        while True:
            params = {"minAccessRole": "freeBusyReader", **({"pageToken": page_token} if page_token else {})}
            body = (await http.request("GET", f"{API}/users/me/calendarList", provider="google", access_token=access_token, params=params)).json()
            for item in body.get("items", []):
                out.append(
                    ExternalCalendar(
                        external_id=item["id"],
                        name=item.get("summaryOverride") or item.get("summary") or item["id"],
                        primary=bool(item.get("primary")),
                        writable=item.get("accessRole") in ("owner", "writer"),
                        timezone=item.get("timeZone"),
                    )
                )
            page_token = body.get("nextPageToken")
            if not page_token:
                return out

    async def get_free_busy(self, access_token: str, calendar_ids: list[str], start: datetime, end: datetime) -> list[BusyInterval]:
        body = (
            await http.request(
                "POST", f"{API}/freeBusy", provider="google", access_token=access_token,
                json={"timeMin": _rfc3339(start), "timeMax": _rfc3339(end), "items": [{"id": c} for c in calendar_ids]},
            )
        ).json()
        out: list[BusyInterval] = []
        for cal_id, data in (body.get("calendars") or {}).items():
            if data.get("errors"):
                raise ConnectorError(f"google freeBusy {cal_id}: {data['errors'][0].get('reason')}", retryable=True)
            for b in data.get("busy", []):
                out.append(BusyInterval(start=_parse_time({"dateTime": b["start"]}, ZoneInfo("UTC")), end=_parse_time({"dateTime": b["end"]}, ZoneInfo("UTC"))))
        return out

    def _event_body(self, event: EventPayload) -> dict[str, Any]:
        return {
            "summary": event.title,
            "location": event.location,
            "description": event.description,
            "start": {"dateTime": _rfc3339(event.start), "timeZone": event.timezone},
            "end": {"dateTime": _rfc3339(event.end), "timeZone": event.timezone},
            "extendedProperties": {"private": {BOOKING_PROPERTY: event.booking_id, **event.extended}},
            "reminders": {"useDefault": True},
        }

    def _ref(self, body: dict[str, Any]) -> EventRef:
        return EventRef(
            external_event_id=body["id"], etag=body.get("etag"),
            start=_parse_time(body["start"], ZoneInfo("UTC")) if body.get("start") else None,
            end=_parse_time(body["end"], ZoneInfo("UTC")) if body.get("end") else None,
        )

    async def create_event(self, access_token: str, calendar_id: str, event: EventPayload) -> EventRef:
        body = {"id": event_id_for(event.booking_id), **self._event_body(event)}
        try:
            res = await http.request("POST", f"{API}/calendars/{_cal(calendar_id)}/events", provider="google", access_token=access_token, json=body)
        except ConnectorError as e:
            if e.status != 409:
                raise
            # Already created by an earlier attempt (or deleted and still remembered): write over it.
            return await self.update_event(access_token, calendar_id, EventRef(body["id"], None), event)
        return self._ref(res.json())

    async def update_event(self, access_token: str, calendar_id: str, ref: EventRef, event: EventPayload) -> EventRef:
        # Our engine is the source of truth, so no If-Match: the job's current state wins. A deleted
        # (cancelled) event comes back to life with status confirmed.
        res = await http.request(
            "PUT", f"{API}/calendars/{_cal(calendar_id)}/events/{quote(ref.external_event_id, safe='')}",
            provider="google", access_token=access_token, json={**self._event_body(event), "status": "confirmed"},
        )
        return self._ref(res.json())

    async def delete_event(self, access_token: str, calendar_id: str, ref: EventRef) -> None:
        try:
            await http.request(
                "DELETE", f"{API}/calendars/{_cal(calendar_id)}/events/{quote(ref.external_event_id, safe='')}",
                provider="google", access_token=access_token,
            )
        except ConnectorError as e:
            if e.status not in (404, 410):
                raise

    async def subscribe_webhook(self, access_token: str, calendar_id: str, callback_url: str, token: str) -> Subscription:
        channel_id = str(uuid.uuid4())
        body = (
            await http.request(
                "POST", f"{API}/calendars/{_cal(calendar_id)}/events/watch", provider="google", access_token=access_token,
                json={
                    "id": channel_id, "type": "web_hook", "address": callback_url, "token": token,
                    "params": {"ttl": str(int(CHANNEL_TTL.total_seconds()))},
                },
            )
        ).json()
        expires = datetime.fromtimestamp(int(body["expiration"]) / 1000, UTC) if body.get("expiration") else datetime.now(UTC) + CHANNEL_TTL
        return Subscription(subscription_id=channel_id, resource_id=body.get("resourceId"), expires_at=expires)

    async def renew_webhook(
        self, access_token: str, calendar_id: str, subscription: Subscription, callback_url: str, token: str
    ) -> Subscription:
        # Google channels can't be extended: open a new one, then close the old one.
        new = await self.subscribe_webhook(access_token, calendar_id, callback_url, token)
        await self.stop_webhook(access_token, subscription)
        return new

    async def stop_webhook(self, access_token: str, subscription: Subscription) -> None:
        try:
            await http.request(
                "POST", f"{API}/channels/stop", provider="google", access_token=access_token,
                json={"id": subscription.subscription_id, "resourceId": subscription.resource_id},
            )
        except ConnectorError as e:
            if e.status not in (404, 410):
                raise

    def handle_webhook(self, headers: dict[str, str], body: bytes) -> dict[str, Any]:
        h = {k.lower(): v for k, v in headers.items()}
        return {
            "channel_id": h.get("x-goog-channel-id", ""),
            "token": h.get("x-goog-channel-token", ""),
            "state": h.get("x-goog-resource-state", ""),
            "resource_id": h.get("x-goog-resource-id", ""),
        }

    async def incremental_sync(
        self, access_token: str, calendar_id: str, cursor: str | None, window_start: datetime, window_end: datetime,
        timezone: str,
    ) -> SyncChanges:
        tz = _zone(timezone)
        params: dict[str, Any] = {"singleEvents": "true", "maxResults": "250"}
        if cursor:
            params["syncToken"] = cursor
            params["showDeleted"] = "true"
        else:
            params["timeMin"] = _rfc3339(window_start)
            params["timeMax"] = _rfc3339(window_end)
        upserted: list[BusyInterval] = []
        deleted: list[str] = []
        next_cursor = None
        while True:
            body = (
                await http.request("GET", f"{API}/calendars/{_cal(calendar_id)}/events", provider="google", access_token=access_token, params=params)
            ).json()
            for event in body.get("items", []):
                props = (event.get("extendedProperties") or {}).get("private") or {}
                booking_id = props.get(BOOKING_PROPERTY)
                ours = booking_id is not None
                # Our own events are tracked even when cancelled, so a deletion in the calendar is noticed.
                if not _is_busy(event) and not (ours and event.get("status") != "cancelled"):
                    deleted.append(event["id"])
                    continue
                if "start" not in event or "end" not in event:
                    continue
                start, end = _parse_time(event["start"], tz), _parse_time(event["end"], tz)
                if end <= window_start or start >= window_end or end <= start:
                    # Outside the window we cache; drop anything we had for it.
                    deleted.append(event["id"])
                    continue
                upserted.append(
                    BusyInterval(start=start, end=end, external_event_id=event["id"], is_ours=ours, booking_id=booking_id, etag=event.get("etag"))
                )
            if body.get("nextPageToken"):
                params = {**params, "pageToken": body["nextPageToken"]}
                continue
            next_cursor = body.get("nextSyncToken")
            break
        return SyncChanges(upserted=upserted, deleted_event_ids=deleted, next_cursor=next_cursor, full=cursor is None)
