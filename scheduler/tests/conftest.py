"""Tests run against a real Postgres 16 (TEST_DATABASE_URL), because the guarantees under test — the
exclusion constraint, row-level security, concurrent transactions — live in the database.

The database is wiped and migrated once per session; every test gets empty tables.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

DB_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sched_test")
INTERNAL_TOKEN = "test-internal-token"
JWT_SECRET = "test-jwt-secret-of-at-least-32-bytes!"
os.environ.update(
    DATABASE_URL=DB_URL,
    INTERNAL_API_TOKEN=INTERNAL_TOKEN,
    SCHED_JWT_SECRET=JWT_SECRET,
    ENCRYPTION_KEY="test-encryption-key",
    REDIS_URL="",
    LOG_JSON="false",
    LOG_LEVEL="WARNING",
    APP_URL="https://app.test",
    GOOGLE_CLIENT_ID="google-client-id",
    GOOGLE_CLIENT_SECRET="google-client-secret",
    # Background jobs run right after each request, so tests see their effect.
    INLINE_JOBS="true",
)

from app.db import dispose_engines  # noqa: E402
from app.main import app  # noqa: E402

# The web app owns these tables; only the columns this service reads are created here.
PUBLIC_SCHEMA = [
    "DROP SCHEMA IF EXISTS sched CASCADE",
    "DROP TABLE IF EXISTS public.api_keys, public.agents, public.tenants CASCADE",
    """CREATE TABLE public.tenants (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'active')""",
    """CREATE TABLE public.agents (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         name text NOT NULL DEFAULT 'agent')""",
    """CREATE TABLE public.api_keys (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
         key_hash text NOT NULL UNIQUE, revoked_at timestamptz, expires_at timestamptz, last_used_at timestamptz)""",
]
SCHED_TABLES = [
    "sync_failures", "sync_state", "external_busy_blocks", "external_event_links", "external_calendars", "connected_accounts",
    "audit_log", "booking_events", "idempotency_keys", "call_artifacts", "round_robin_state", "bookings",
    "customer_addresses", "customers", "time_off", "working_hours", "services", "staff", "business_settings",
]


@pytest.fixture(scope="session")
async def admin() -> AsyncIterator[AsyncEngine]:
    """Superuser engine for setup; bypasses row-level security."""
    engine = create_async_engine(DB_URL)
    async with engine.begin() as conn:
        for statement in PUBLIC_SCHEMA:
            await conn.execute(text(statement))
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, cwd=os.path.dirname(os.path.dirname(__file__)))
    yield engine
    await engine.dispose()
    await dispose_engines()


@pytest.fixture(autouse=True)
async def clean(admin: AsyncEngine) -> None:
    async with admin.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join('sched.' + t for t in SCHED_TABLES)} CASCADE"))
        await conn.execute(text("TRUNCATE public.tenants CASCADE"))


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://sched") as c:
        yield c


@dataclass
class Biz:
    id: uuid.UUID
    agent_id: uuid.UUID
    api_key: str
    tz: ZoneInfo

    @property
    def agent_headers(self) -> dict[str, str]:
        return {"authorization": f"Bearer {INTERNAL_TOKEN}", "x-agent-id": str(self.agent_id)}

    def dashboard_headers(self, role: str = "owner", user_id: str | None = None) -> dict[str, str]:
        token = jwt.encode(
            {"sub": user_id or str(uuid.uuid4()), "bid": str(self.id), "role": role, "aud": "sched", "exp": int(time.time()) + 60},
            JWT_SECRET,
            algorithm="HS256",
        )
        return {"authorization": f"Bearer {token}"}


class Factory:
    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    async def business(self, *, tz: str = "America/New_York", vertical: str = "hvac", **settings: object) -> Biz:
        api_key = f"vk_{secrets.token_urlsafe(32)}"
        values = {
            "timezone": tz, "vertical": vertical, "min_notice_min": 120, "max_days_ahead": 30,
            "slot_granularity_min": 30, "hold_ttl_sec": 180, **settings,
        }
        async with self.engine.begin() as conn:
            business_id = (await conn.execute(text("INSERT INTO public.tenants (name) VALUES ('Acme HVAC') RETURNING id"))).scalar_one()
            agent_id = (
                await conn.execute(text("INSERT INTO public.agents (tenant_id) VALUES (:b) RETURNING id"), {"b": business_id})
            ).scalar_one()
            await conn.execute(
                text("INSERT INTO public.api_keys (tenant_id, key_hash) VALUES (:b, :h)"),
                {"b": business_id, "h": hashlib.sha256(api_key.encode()).hexdigest()},
            )
            area = json.dumps(values.pop("service_area", {}))
            columns = ", ".join(values)
            params = ", ".join(f":{k}" for k in values)
            await conn.execute(
                text(
                    f"INSERT INTO sched.business_settings (business_id, service_area, {columns}) "
                    f"VALUES (:business_id, CAST(:area AS jsonb), {params})"
                ),
                {"business_id": business_id, "area": area, **values},
            )
        return Biz(id=business_id, agent_id=agent_id, api_key=api_key, tz=ZoneInfo(tz))

    async def staff(
        self,
        biz: Biz,
        name: str,
        *,
        skills: list[str] | None = None,
        zones: list[str] | None = None,
        hours: list[tuple[int, str, str]] | None = None,
        priority: int = 0,
        daily_job_cap: int | None = None,
        active: bool = True,
    ) -> uuid.UUID:
        """`hours` are (weekday, "HH:MM", "HH:MM"); default Monday–Friday 08:00–17:00."""
        hours = hours if hours is not None else [(d, "08:00", "17:00") for d in range(5)]
        async with self.engine.begin() as conn:
            staff_id = (
                await conn.execute(
                    text(
                        "INSERT INTO sched.staff (business_id, name, skills, zones, priority, daily_job_cap, active) "
                        "VALUES (:b, :n, :s, :z, :p, :c, :a) RETURNING id"
                    ),
                    {"b": biz.id, "n": name, "s": skills or [], "z": zones or [], "p": priority, "c": daily_job_cap, "a": active},
                )
            ).scalar_one()
            for weekday, start, end in hours:
                await conn.execute(
                    text(
                        "INSERT INTO sched.working_hours (business_id, staff_id, weekday, start_min, end_min) VALUES (:b, :s, :w, :a, :e)"
                    ),
                    {"b": biz.id, "s": staff_id, "w": weekday, "a": _minutes(start), "e": _minutes(end)},
                )
        return staff_id

    async def service(
        self, biz: Biz, name: str = "AC repair", *, duration: int = 60, before: int = 0, after: int = 0,
        skills: list[str] | None = None,
    ) -> uuid.UUID:
        async with self.engine.begin() as conn:
            return (
                await conn.execute(
                    text(
                        "INSERT INTO sched.services (business_id, name, duration_min, buffer_before_min, buffer_after_min, required_skills) "
                        "VALUES (:b, :n, :d, :bb, :ba, :s) RETURNING id"
                    ),
                    {"b": biz.id, "n": name, "d": duration, "bb": before, "ba": after, "s": skills or []},
                )
            ).scalar_one()

    async def time_off(self, biz: Biz, staff_id: uuid.UUID, start: datetime, end: datetime) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(
                text("INSERT INTO sched.time_off (business_id, staff_id, period) VALUES (:b, :s, tstzrange(:a, :e))"),
                {"b": biz.id, "s": staff_id, "a": start, "e": end},
            )

    async def scalar(self, sql: str, **params: object) -> object:
        async with self.engine.begin() as conn:
            return (await conn.execute(text(sql), params)).scalar()

    async def execute(self, sql: str, **params: object) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(text(sql), params)


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


@pytest.fixture
def factory(admin: AsyncEngine) -> Factory:
    return Factory(admin)


def next_weekday(tz: ZoneInfo, weekday: int = 1, min_days: int = 3) -> date:
    """A date at least `min_days` ahead that falls on `weekday` (0 = Monday)."""
    d = datetime.now(tz).date() + timedelta(days=min_days)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def local(d: date, hhmm: str, tz: ZoneInfo) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=tz)
