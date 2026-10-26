from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .base import DefaultService, VerticalPack


class HvacDetails(BaseModel):
    """Extra job fields an HVAC dispatcher wants before rolling a truck."""

    model_config = ConfigDict(extra="forbid")

    system_type: Literal["central_ac", "heat_pump", "furnace", "boiler", "mini_split", "other"] | None = None
    equipment_brand: str | None = Field(default=None, max_length=80)
    system_age_years: int | None = Field(default=None, ge=0, le=100)
    no_heat: bool | None = None
    no_cooling: bool | None = None
    has_warranty: bool | None = None
    access_notes: str | None = Field(default=None, max_length=500)


HVAC = VerticalPack(
    key="hvac",
    name="HVAC",
    labels={
        "staff": "Technician",
        "staff_plural": "Technicians",
        "booking": "Job",
        "booking_plural": "Jobs",
        "customer": "Customer",
    },
    skills=(
        "ac_repair",
        "ac_install",
        "furnace_repair",
        "furnace_install",
        "heat_pump",
        "boiler",
        "ductwork",
        "maintenance",
        "commercial",
    ),
    default_services=(
        DefaultService("AC repair", 90, 15, 15, ("ac_repair",)),
        DefaultService("Furnace repair", 90, 15, 15, ("furnace_repair",)),
        DefaultService("Maintenance tune-up", 60, 15, 15, ("maintenance",)),
        DefaultService("System estimate", 60, 15, 15, ()),
        DefaultService("AC installation", 240, 30, 30, ("ac_install",)),
        DefaultService("Furnace installation", 240, 30, 30, ("furnace_install",)),
    ),
    details_model=HvacDetails,
    event_title="HVAC: {service} – {customer}",
    agent_hints=(
        "Ask whether the system is not heating or not cooling at all; no heat in winter or no cooling in a heat wave "
        "is an emergency, so book it with urgency emergency.",
        "Ask for the service address including the ZIP code before checking availability.",
    ),
)
