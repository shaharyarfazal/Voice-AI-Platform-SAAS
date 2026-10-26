"""Requests and responses of the voice agent tool API. Small, flat, and every response has `ok` and a
`message` an LLM can relay to a caller."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Urgency = Literal["emergency", "standard"]


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class TimeRange(_In):
    from_: str = Field(alias="from", pattern=r"^([01]\d|2[0-3]):[0-5]\d$", examples=["09:00"])
    to: str = Field(pattern=r"^([01]\d|2[0-4]):[0-5]\d$", examples=["12:00"])


class AddressIn(_In):
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=2)


class CheckAvailabilityIn(_In):
    service: str = Field(min_length=1, max_length=120, description="Service name (e.g. 'AC repair') or id")
    date: str | None = Field(default=None, description="Local date YYYY-MM-DD; omit for the next openings")
    time_window: Literal["morning", "afternoon", "evening", "any"] | TimeRange | None = None
    address: str | None = Field(default=None, max_length=300)
    postal_code: str | None = Field(default=None, max_length=20)
    technician: str | None = Field(default=None, max_length=120, description="Only if the caller asks for someone")
    urgency: Urgency = "standard"
    limit: int = Field(default=5, ge=1, le=10)


class ServiceRef(BaseModel):
    id: uuid.UUID
    name: str
    duration_min: int


class SlotOut(BaseModel):
    slot_id: str = Field(description="Local start time; pass it to hold_slot")
    start: str
    end: str
    label: str
    technicians_available: int


class CheckAvailabilityOut(BaseModel):
    ok: Literal[True] = True
    message: str
    timezone: str
    service: ServiceRef
    slots: list[SlotOut]


class HoldIn(_In):
    slot_id: str = Field(description="A slot_id from check_availability")
    service: str = Field(min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=300)
    postal_code: str | None = Field(default=None, max_length=20)
    technician: str | None = Field(default=None, max_length=120)
    urgency: Urgency = "standard"
    call_id: str | None = Field(default=None, max_length=200)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)


class HoldOut(BaseModel):
    ok: Literal[True] = True
    hold_id: uuid.UUID
    slot_id: str
    label: str
    expires_at: str
    expires_in_sec: int
    technician_first_name: str
    message: str


class BookIn(_In):
    hold_id: uuid.UUID
    customer_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=3, max_length=40)
    address: AddressIn | str | None = None
    issue_description: str = Field(default="", max_length=2000)
    urgency: Urgency | None = None
    call_id: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    details: dict[str, Any] | None = Field(default=None, description="Industry-specific job fields")
    idempotency_key: str = Field(min_length=1, max_length=200)


class BookOut(BaseModel):
    ok: Literal[True] = True
    booking_id: uuid.UUID
    confirmation_code: str
    start: str
    end: str
    date_label: str
    time_window: str
    technician_first_name: str
    message: str


class FindIn(_In):
    phone: str = Field(min_length=3, max_length=40)
    date: str | None = None


class AppointmentOut(BaseModel):
    booking_id: uuid.UUID
    confirmation_code: str | None
    status: str
    start: str
    label: str
    service: str
    technician_first_name: str
    address_short: str | None


class FindOut(BaseModel):
    ok: Literal[True] = True
    appointments: list[AppointmentOut]
    message: str


class RescheduleIn(_In):
    booking_id: uuid.UUID | None = None
    phone: str | None = Field(default=None, max_length=40)
    date: str | None = Field(default=None, description="Current appointment date, to find it by phone")
    new_slot_id: str
    idempotency_key: str = Field(min_length=1, max_length=200)


class CancelIn(_In):
    booking_id: uuid.UUID | None = None
    phone: str | None = Field(default=None, max_length=40)
    date: str | None = None
    reason: str | None = Field(default=None, max_length=500)
    idempotency_key: str = Field(min_length=1, max_length=200)


class CancelOut(BaseModel):
    ok: Literal[True] = True
    booking_id: uuid.UUID
    status: str
    message: str


class ArtifactsIn(_In):
    recording_url: str | None = Field(default=None, max_length=2000, pattern=r"^https://")
    transcript: str | None = Field(default=None, max_length=500_000)
    transcript_segments: list[dict[str, Any]] | None = None
    summary: dict[str, Any] | None = None


class ArtifactsOut(BaseModel):
    ok: Literal[True] = True
    bookings_linked: int


class ErrorOut(BaseModel):
    ok: Literal[False] = False
    code: str
    message: str
    alternatives: list[SlotOut] | None = None
