import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "sched"


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))


def business_fk() -> Mapped[uuid.UUID]:
    # References public.tenants(id); declared in the migration, not here, because the web app
    # (not this service) owns that table.
    return mapped_column(UUID(as_uuid=True), nullable=False, index=True)


def created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


def updated_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
