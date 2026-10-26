import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, business_fk, created_at, updated_at, uuid_pk


class Service(Base):
    """A bookable type of job (e.g. "AC repair"), with its length and the travel/prep buffers around it."""

    __tablename__ = "services"

    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = business_fk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)
    buffer_before_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    buffer_after_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    required_skills: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()
