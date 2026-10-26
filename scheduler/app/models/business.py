import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, created_at, updated_at


class BusinessSettings(Base):
    """Per-business scheduling rules. One row per tenant (public.tenants)."""

    __tablename__ = "business_settings"

    business_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    vertical: Mapped[str] = mapped_column(Text, nullable=False, default="generic")
    timezone: Mapped[str] = mapped_column(Text, nullable=False, default="UTC")
    slot_granularity_min: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    min_notice_min: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    emergency_min_notice_min: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    max_days_ahead: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    hold_ttl_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    default_daily_job_cap: Mapped[int | None] = mapped_column(Integer)
    assignment_mode: Mapped[str] = mapped_column(Text, nullable=False, default="least_busy")
    unavailable_on_reauth: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # {"postal_codes": [...], "center": {"lat", "lng"} | null, "radius_km": number | null}
    service_area: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # Overrides of the vertical's labels, e.g. {"staff": "Installer"}.
    labels: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
