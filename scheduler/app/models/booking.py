import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TSTZRANGE, UUID, Range
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, business_fk, created_at, updated_at, uuid_pk

# Statuses that occupy a staff member's time (the exclusion constraint applies to these).
ACTIVE_STATUSES = ("held", "confirmed")


class Booking(Base):
    """A job. `time_range` is what the customer is told; `blocked_range` adds the service's buffers and
    is what the exclusion constraint keeps from overlapping for one staff member."""

    __tablename__ = "bookings"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id"), nullable=False)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"))
    service_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("services.id"), nullable=False)
    time_range: Mapped[Range[datetime]] = mapped_column(TSTZRANGE, nullable=False)
    blocked_range: Mapped[Range[datetime]] = mapped_column(TSTZRANGE, nullable=False)
    # held | confirmed | completed | canceled | expired | released
    status: Mapped[str] = mapped_column(Text, nullable=False)
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    service_address: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    address_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customer_addresses.id", ondelete="SET NULL"))
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    urgency: Mapped[str] = mapped_column(Text, nullable=False, default="standard")
    source: Mapped[str] = mapped_column(Text, nullable=False)
    # The voice call this job came from (public.calls.room_name for our own agent).
    call_id: Mapped[str | None] = mapped_column(Text)
    confirmation_code: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Vertical-specific fields, validated by the business's vertical pack.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    assignment_reason: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Set when the linked external calendar event was moved or deleted outside our system (Phase 2).
    external_change: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class BookingEvent(Base):
    """Status history: one row per change to a booking."""

    __tablename__ = "booking_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    business_id: Mapped[uuid.UUID] = business_fk()
    booking_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    from_status: Mapped[str | None] = mapped_column(Text)
    to_status: Mapped[str | None] = mapped_column(Text)
    actor_type: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CallArtifact(Base):
    """Recording, transcript and summary sent after a call by a voice agent (third-party agents; our own
    agent's calls are read from public.calls)."""

    __tablename__ = "call_artifacts"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    call_id: Mapped[str] = mapped_column(Text, nullable=False)
    recording_key: Mapped[str | None] = mapped_column(Text)
    recording_url: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    transcript_segments: Mapped[list[Any] | None] = mapped_column(JSONB)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()


class IdempotencyKey(Base):
    """One row per idempotent request: a retry with the same key gets the stored response."""

    __tablename__ = "idempotency_keys"

    business_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = created_at()


class RoundRobinState(Base):
    __tablename__ = "round_robin_state"

    business_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    pool_key: Mapped[str] = mapped_column(Text, primary_key=True)
    last_staff_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    counts: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = updated_at()
