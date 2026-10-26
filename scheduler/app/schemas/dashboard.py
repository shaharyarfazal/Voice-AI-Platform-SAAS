"""Request bodies of the dashboard API (/v1). Called only by the web app's server-side proxy."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .agent import AddressIn

Hex = r"^#[0-9a-fA-F]{6}$"


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ServiceArea(_In):
    postal_codes: list[str] = Field(default_factory=list, max_length=2000)
    center: dict[str, float] | None = None
    radius_km: float | None = Field(default=None, gt=0, le=500)


class SettingsIn(_In):
    vertical: str = "generic"
    timezone: str
    slot_granularity_min: int = Field(30, ge=5, le=240)
    min_notice_min: int = Field(120, ge=0, le=60 * 24 * 14)
    emergency_min_notice_min: int = Field(30, ge=0, le=60 * 24)
    max_days_ahead: int = Field(30, ge=1, le=365)
    hold_ttl_sec: int = Field(180, ge=30, le=1800)
    default_daily_job_cap: int | None = Field(default=None, gt=0, le=100)
    assignment_mode: Literal["least_busy", "round_robin", "weighted", "priority"] = "least_busy"
    unavailable_on_reauth: bool = True
    service_area: ServiceArea = Field(default_factory=ServiceArea)
    labels: dict[str, str] = Field(default_factory=dict)


class StaffIn(_In):
    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    timezone: str | None = None
    skills: list[str] = Field(default_factory=list, max_length=50)
    zones: list[str] = Field(default_factory=list, max_length=500)
    active: bool = True
    rr_weight: int = Field(1, ge=1, le=100)
    priority: int = Field(0, ge=-100, le=100)
    daily_job_cap: int | None = Field(default=None, gt=0, le=100)
    color: str | None = Field(default=None, pattern=Hex)


class StaffPatch(_In):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    timezone: str | None = None
    skills: list[str] | None = Field(default=None, max_length=50)
    zones: list[str] | None = Field(default=None, max_length=500)
    active: bool | None = None
    rr_weight: int | None = Field(default=None, ge=1, le=100)
    priority: int | None = Field(default=None, ge=-100, le=100)
    daily_job_cap: int | None = Field(default=None, gt=0, le=100)
    color: str | None = Field(default=None, pattern=Hex)


class WorkingWindow(_In):
    weekday: int = Field(ge=0, le=6, description="0 = Monday")
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")

    @staticmethod
    def minutes(value: str) -> int:
        h, m = value.split(":")
        return int(h) * 60 + int(m)

    @model_validator(mode="after")
    def _ordered(self) -> WorkingWindow:
        if self.minutes(self.start) >= self.minutes(self.end):
            raise ValueError("start must be before end")
        return self


class WorkingHoursIn(_In):
    windows: list[WorkingWindow] = Field(max_length=50)


class TimeOffIn(_In):
    start: datetime
    end: datetime
    reason: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def _ordered(self) -> TimeOffIn:
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("start and end need a UTC offset")
        if self.start >= self.end:
            raise ValueError("start must be before end")
        return self


class ServiceIn(_In):
    name: str = Field(min_length=1, max_length=120)
    duration_min: int = Field(ge=5, le=1440)
    buffer_before_min: int = Field(0, ge=0, le=480)
    buffer_after_min: int = Field(0, ge=0, le=480)
    required_skills: list[str] = Field(default_factory=list, max_length=20)
    active: bool = True


class ServicePatch(_In):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    duration_min: int | None = Field(default=None, ge=5, le=1440)
    buffer_before_min: int | None = Field(default=None, ge=0, le=480)
    buffer_after_min: int | None = Field(default=None, ge=0, le=480)
    required_skills: list[str] | None = Field(default=None, max_length=20)
    active: bool | None = None


class CustomerIn(_In):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=3, max_length=40)
    email: str | None = Field(default=None, max_length=200)


class BookingCreate(_In):
    service_id: uuid.UUID
    start: datetime
    staff_id: uuid.UUID | None = None
    customer: CustomerIn
    address: AddressIn | None = None
    description: str = Field(default="", max_length=2000)
    urgency: Literal["emergency", "standard"] = "standard"
    notes: str = Field(default="", max_length=4000)
    details: dict[str, Any] | None = None
    # An owner may book outside working hours / notice rules; overlaps are never allowed.
    override_rules: bool = False

    @field_validator("start")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("start needs a UTC offset")
        return v


class BookingPatch(_In):
    version: int = Field(description="The version you last saw; a stale one gets 409 version_conflict")
    start: datetime | None = None
    staff_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    urgency: Literal["emergency", "standard"] | None = None
    details: dict[str, Any] | None = None
    override_rules: bool = False

    @field_validator("start")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("start needs a UTC offset")
        return v


class CancelBody(_In):
    reason: str | None = Field(default=None, max_length=500)


class AvailabilityQuery(_In):
    service_id: uuid.UUID
    start: datetime
    end: datetime
    staff_id: uuid.UUID | None = None
    postal_code: str | None = None
    urgency: Literal["emergency", "standard"] = "standard"
