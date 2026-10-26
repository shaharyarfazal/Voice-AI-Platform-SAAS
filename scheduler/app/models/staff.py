import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY, TSTZRANGE, UUID, Range
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, business_fk, created_at, updated_at, uuid_pk


class Staff(Base):
    """A person jobs are assigned to (a technician in the HVAC vertical)."""

    __tablename__ = "staff"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    phone_e164: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    # IANA zone for working hours; null = the business's timezone.
    timezone: Mapped[str | None] = mapped_column(Text)
    skills: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    # Postal codes this person covers; empty = the whole service area.
    zones: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    rr_weight: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    daily_job_cap: Mapped[int | None] = mapped_column(Integer)
    color: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    @property
    def first_name(self) -> str:
        return self.name.split()[0] if self.name.strip() else self.name


class WorkingHours(Base):
    """A weekly working window in the person's local time. Several rows per weekday allow split shifts."""

    __tablename__ = "working_hours"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"), nullable=False, index=True)
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 0 = Monday … 6 = Sunday
    start_min: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # minutes after local midnight, 0–1439
    end_min: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 1–1440


class TimeOff(Base):
    __tablename__ = "time_off"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"), nullable=False)
    period: Mapped[Range[datetime]] = mapped_column(TSTZRANGE, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = created_at()
