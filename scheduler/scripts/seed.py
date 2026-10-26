"""Set up scheduling for an existing workspace with demo data: HVAC settings, the vertical's default
services, three technicians with working hours and, optionally, a few booked jobs.

    python -m scripts.seed --tenant-id <workspace uuid> [--timezone America/New_York] [--jobs]

Safe to run twice: existing settings are kept, services are added only if missing, and technicians
are created only when the workspace has none.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.context import Actor, RequestContext
from app.core import booking as engine
from app.core.availability import SlotQuery, find_slots
from app.db import dispose_engines, tenant_session
from app.logging import configure_logging
from app.models import BusinessSettings, Service, Staff, WorkingHours
from app.verticals import get_vertical

TECHNICIANS = [
    ("Mike Ross", ["ac_repair", "ac_install", "maintenance"], "#2563eb"),
    ("Anna Lee", ["furnace_repair", "furnace_install", "heat_pump", "maintenance"], "#16a34a"),
    ("Carlos Diaz", ["ac_repair", "furnace_repair", "maintenance", "ductwork"], "#d97706"),
]
CUSTOMERS = [("John Smith", "+12125550101", "12 Main St"), ("Maria Garcia", "+12125550102", "48 Oak Ave"), ("Wei Chen", "+12125550103", "7 Pine Rd")]


async def seed(tenant_id: uuid.UUID, timezone: str, jobs: bool) -> None:
    vertical = get_vertical("hvac")
    async with tenant_session(tenant_id) as session:
        await session.execute(
            insert(BusinessSettings)
            .values(business_id=tenant_id, vertical="hvac", timezone=timezone, min_notice_min=60)
            .on_conflict_do_nothing()
        )
        existing = set((await session.scalars(select(func.lower(Service.name)).where(Service.business_id == tenant_id))).all())
        for d in vertical.default_services:
            if d.name.lower() not in existing:
                session.add(
                    Service(
                        business_id=tenant_id, name=d.name, duration_min=d.duration_min,
                        buffer_before_min=d.buffer_before_min, buffer_after_min=d.buffer_after_min,
                        required_skills=list(d.required_skills),
                    )
                )
        if not await session.scalar(select(func.count()).select_from(Staff).where(Staff.business_id == tenant_id)):
            for name, skills, color in TECHNICIANS:
                tech = Staff(business_id=tenant_id, name=name, skills=skills, color=color)
                session.add(tech)
                await session.flush()
                for weekday in range(5):
                    session.add(WorkingHours(business_id=tenant_id, staff_id=tech.id, weekday=weekday, start_min=8 * 60, end_min=17 * 60))
                session.add(WorkingHours(business_id=tenant_id, staff_id=tech.id, weekday=5, start_min=9 * 60, end_min=13 * 60))
        print("settings, services and technicians ready")

    if not jobs:
        return
    ctx = RequestContext(business_id=tenant_id, actor=Actor("system", "seed"))
    async with tenant_session(tenant_id) as session:
        settings = await session.get(BusinessSettings, tenant_id)
        assert settings is not None
        services = (await session.scalars(select(Service).where(Service.business_id == tenant_id, Service.duration_min <= 90))).all()
        now = datetime.now().astimezone()
        q = SlotQuery(tenant_id, settings, services[0], now, now + timedelta(days=7), now)
        slots = await find_slots(session, q)
        for i, (name, phone, street) in enumerate(CUSTOMERS):
            slot = slots[min(len(slots) - 1, i * max(1, len(slots) // 4))]
            held = await engine.hold(session, ctx, settings=settings, service=services[0], start=slot.start, now=now, source="dashboard")
            await engine.confirm(
                session, ctx, settings=settings, booking=held.booking, now=now,
                customer=engine.CustomerInput(name=name, phone_e164=phone, email=None, address={"line1": street, "postal_code": "10001"}),
                description="Demo job",
            )
        print(f"booked {len(CUSTOMERS)} demo jobs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tenant-id", required=True, type=uuid.UUID)
    parser.add_argument("--timezone", default="America/New_York")
    parser.add_argument("--jobs", action="store_true", help="also book a few demo jobs")
    args = parser.parse_args()
    configure_logging()

    async def run() -> None:
        try:
            await seed(args.tenant_id, args.timezone, args.jobs)
        finally:
            await dispose_engines()

    asyncio.run(run())


if __name__ == "__main__":
    main()
