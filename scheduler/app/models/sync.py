import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSTZRANGE, UUID, Range
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, business_fk, created_at, updated_at, uuid_pk


class ConnectedAccount(Base):
    """A staff member's account at a calendar provider (or a business's CRM account). Tokens are
    encrypted (app/security/crypto.py) and never logged."""

    __tablename__ = "connected_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    staff_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="calendar")
    external_account_id: Mapped[str | None] = mapped_column(Text)
    external_email: Mapped[str] = mapped_column(Text, nullable=False)
    access_token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    # active | needs_reauth | revoked
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    last_error: Mapped[str | None] = mapped_column(Text)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class ExternalCalendar(Base):
    __tablename__ = "external_calendars"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    connected_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("connected_accounts.id", ondelete="CASCADE"), nullable=False)
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"), nullable=False)
    external_calendar_id: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    timezone: Mapped[str | None] = mapped_column(Text)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    writable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    use_for_busy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    write_bookings_here: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class ExternalEventLink(Base):
    """Our job ↔ the event we wrote for it."""

    __tablename__ = "external_event_links"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    external_calendar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("external_calendars.id", ondelete="CASCADE"), nullable=False)
    external_event_id: Mapped[str] = mapped_column(Text, nullable=False)
    etag: Mapped[str | None] = mapped_column(Text)
    pushed_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pushed_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_pushed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ExternalBusyBlock(Base):
    """Cached busy time from a staff member's calendar. Events we wrote are kept (is_ours) to notice
    when someone moves or deletes them, but never count as busy (the job itself does)."""

    __tablename__ = "external_busy_blocks"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"), nullable=False)
    external_calendar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("external_calendars.id", ondelete="CASCADE"), nullable=False)
    external_event_id: Mapped[str] = mapped_column(Text, nullable=False)
    period: Mapped[Range[datetime]] = mapped_column(TSTZRANGE, nullable=False)
    is_ours: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    updated_at: Mapped[datetime] = updated_at()


class SyncState(Base):
    __tablename__ = "sync_state"

    external_calendar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("external_calendars.id", ondelete="CASCADE"), primary_key=True)
    business_id: Mapped[uuid.UUID] = business_fk()
    # Google syncToken / Microsoft deltaLink.
    cursor: Mapped[str | None] = mapped_column(Text)
    channel_id: Mapped[str | None] = mapped_column(Text, unique=True)
    resource_id: Mapped[str | None] = mapped_column(Text)
    channel_token_hash: Mapped[str | None] = mapped_column(Text)
    channel_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_full_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_incremental_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SyncFailure(Base):
    """Dead-letter queue: a calendar write that failed after its retries. Shown in the dashboard
    with a retry button."""

    __tablename__ = "sync_failures"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    booking_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"))
    connected_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("connected_accounts.id", ondelete="SET NULL"))
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_error: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="dead")
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
