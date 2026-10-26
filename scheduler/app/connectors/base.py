"""Pluggable connectors to external calendars and CRMs.

A connector translates between our engine (the source of truth) and one provider. Adding a provider
(iCloud via CalDAV, Jobber, ServiceTitan…) means implementing this interface and registering it; the
booking engine only calls the methods below.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, ClassVar


@dataclass(frozen=True)
class OAuthTokens:
    access_token: str
    refresh_token: str | None
    expires_at: datetime
    scopes: tuple[str, ...]
    account_email: str


@dataclass(frozen=True)
class ExternalCalendar:
    external_id: str
    name: str
    primary: bool = False
    writable: bool = True
    timezone: str | None = None


@dataclass(frozen=True)
class BusyInterval:
    start: datetime
    end: datetime
    external_event_id: str | None = None
    # True when the event was written by us (an echo of one of our bookings).
    is_ours: bool = False
    booking_id: str | None = None
    etag: str | None = None


@dataclass(frozen=True)
class EventPayload:
    """What we write to an external calendar for a booking. No transcripts: privacy."""

    booking_id: str
    title: str
    start: datetime
    end: datetime
    location: str | None
    description: str
    timezone: str
    extended: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class EventRef:
    external_event_id: str
    etag: str | None
    start: datetime | None = None
    end: datetime | None = None


@dataclass(frozen=True)
class SyncChanges:
    upserted: list[BusyInterval]
    deleted_event_ids: list[str]
    next_cursor: str | None
    # True when this was a full listing of the window: anything not in `upserted` is gone.
    full: bool = False


@dataclass(frozen=True)
class Subscription:
    subscription_id: str
    resource_id: str | None
    expires_at: datetime
    client_state: str | None = None


class ConnectorError(Exception):
    """A provider call failed. `retryable` decides between backoff and the dead-letter queue."""

    def __init__(
        self, message: str, *, retryable: bool, needs_reauth: bool = False, status: int | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.needs_reauth = needs_reauth
        self.status = status
        self.retry_after = retry_after


class CursorExpired(ConnectorError):
    """The sync token/delta link is no longer valid (Google 410): do a full resync."""

    def __init__(self) -> None:
        super().__init__("sync cursor expired", retryable=False, status=410)


class NotFound(ConnectorError):
    def __init__(self, message: str = "not found") -> None:
        super().__init__(message, retryable=False, status=404)


class CalendarConnector(abc.ABC):
    provider: ClassVar[str]
    # "calendar" connectors hold a staff member's busy time; "crm" connectors receive jobs (may be one-way).
    kind: ClassVar[str] = "calendar"
    # Shown in the dashboard; e.g. iCloud needs an app-specific password rather than one-tap OAuth.
    one_tap: ClassVar[bool] = True

    # OAuth
    @abc.abstractmethod
    def get_oauth_url(self, state: str, redirect_uri: str) -> str: ...

    @abc.abstractmethod
    async def handle_oauth_callback(self, code: str, redirect_uri: str) -> OAuthTokens: ...

    @abc.abstractmethod
    async def refresh_token(self, refresh_token: str) -> OAuthTokens: ...

    # Calendars and availability
    @abc.abstractmethod
    async def list_calendars(self, access_token: str) -> list[ExternalCalendar]: ...

    @abc.abstractmethod
    async def get_free_busy(
        self, access_token: str, calendar_ids: list[str], start: datetime, end: datetime
    ) -> list[BusyInterval]: ...

    # Writing our bookings
    @abc.abstractmethod
    async def create_event(self, access_token: str, calendar_id: str, event: EventPayload) -> EventRef: ...

    @abc.abstractmethod
    async def update_event(self, access_token: str, calendar_id: str, ref: EventRef, event: EventPayload) -> EventRef: ...

    @abc.abstractmethod
    async def delete_event(self, access_token: str, calendar_id: str, ref: EventRef) -> None: ...

    # Change detection
    @abc.abstractmethod
    async def subscribe_webhook(self, access_token: str, calendar_id: str, callback_url: str, token: str) -> Subscription: ...

    @abc.abstractmethod
    async def renew_webhook(
        self, access_token: str, calendar_id: str, subscription: Subscription, callback_url: str, token: str
    ) -> Subscription: ...

    @abc.abstractmethod
    async def stop_webhook(self, access_token: str, subscription: Subscription) -> None: ...

    @abc.abstractmethod
    async def revoke(self, token: str) -> None:
        """Revoke our access at the provider (on disconnect)."""

    @abc.abstractmethod
    def handle_webhook(self, headers: dict[str, str], body: bytes) -> dict[str, Any]:
        """Verify and parse a notification. Must be fast: the actual sync runs in the background."""

    @abc.abstractmethod
    async def incremental_sync(
        self, access_token: str, calendar_id: str, cursor: str | None, window_start: datetime, window_end: datetime,
        timezone: str,
    ) -> SyncChanges:
        """Changes since `cursor`, or a full listing of the window when `cursor` is None. Raises
        CursorExpired when the cursor is no longer valid."""


_REGISTRY: dict[str, type[CalendarConnector]] = {}


def register(cls: type[CalendarConnector]) -> type[CalendarConnector]:
    _REGISTRY[cls.provider] = cls
    return cls


def connector_for(provider: str) -> CalendarConnector:
    try:
        return _REGISTRY[provider]()
    except KeyError as e:
        raise ConnectorError(f"No connector for provider {provider!r}", retryable=False) from e


def providers() -> list[str]:
    return sorted(_REGISTRY)
