"""Vertical packs: what changes between industries (HVAC, plumbing, cleaning…) without touching the
core engine — words shown to users, the skills catalog, default services, extra job fields, and how
jobs are titled in external calendars."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from ..errors import ApiError


class NoDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True)
class DefaultService:
    name: str
    duration_min: int
    buffer_before_min: int = 0
    buffer_after_min: int = 0
    required_skills: tuple[str, ...] = ()


@dataclass(frozen=True)
class VerticalPack:
    key: str
    name: str
    # Words the dashboard and agent use: staff, staff_plural, booking, booking_plural, customer.
    labels: dict[str, str]
    skills: tuple[str, ...] = ()
    default_services: tuple[DefaultService, ...] = ()
    # Validates bookings.details for this vertical.
    details_model: type[BaseModel] = NoDetails
    # Title of the event written to a staff member's external calendar (Phase 2).
    event_title: str = "{service} – {customer}"
    # Extra guidance appended to the agent's booking instructions.
    agent_hints: tuple[str, ...] = field(default_factory=tuple)

    def validate_details(self, details: dict[str, Any] | None) -> dict[str, Any]:
        if not details:
            return {}
        try:
            return self.details_model.model_validate(details).model_dump(exclude_none=True)
        except ValidationError as e:
            first = e.errors()[0]
            where = ".".join(str(p) for p in first["loc"]) or "details"
            raise ApiError("invalid_details", f"Invalid job detail {where}: {first['msg']}.") from e

    def title_for(self, service: str, customer: str) -> str:
        return self.event_title.format(service=service, customer=customer)
