from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...context import RequestContext
from ...core.audit import audit
from ...errors import ApiError
from ...models import BusinessSettings, Service
from ...schemas.dashboard import ServiceIn, ServicePatch
from ...security.auth import dashboard_context, require_admin
from ...verticals import get_vertical
from ..deps import run
from .serialize import service_out

router = APIRouter()


def _duplicate(e: IntegrityError) -> ApiError:
    return ApiError("duplicate_service", "A service with that name already exists.", status=409)


@router.get("/services")
async def list_services(ctx: RequestContext = Depends(dashboard_context)) -> list[dict[str, Any]]:
    async def fn(session: AsyncSession) -> list[dict[str, Any]]:
        rows = (await session.scalars(select(Service).where(Service.business_id == ctx.business_id).order_by(Service.name))).all()
        return [service_out(s) for s in rows]

    return await run(ctx, fn)


@router.post("/services", status_code=201)
async def create_service(body: ServiceIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    require_admin(ctx)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        s = Service(business_id=ctx.business_id, **body.model_dump())
        try:
            async with session.begin_nested():
                session.add(s)
                await session.flush()
        except IntegrityError as e:
            raise _duplicate(e) from e
        audit(session, ctx.business_id, ctx.actor, "service.create", "service", s.id, name=s.name)
        return service_out(s)

    return await run(ctx, fn)


@router.patch("/services/{service_id}")
async def update_service(service_id: uuid.UUID, body: ServicePatch, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    require_admin(ctx)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        s = await session.scalar(select(Service).where(Service.business_id == ctx.business_id, Service.id == service_id))
        if s is None:
            raise ApiError("not_found", "No such service.", status=404)
        changes = body.model_dump(exclude_unset=True)
        for key, value in changes.items():
            setattr(s, key, value)
        try:
            async with session.begin_nested():
                await session.flush()
        except IntegrityError as e:
            raise _duplicate(e) from e
        audit(session, ctx.business_id, ctx.actor, "service.update", "service", s.id, **changes)
        return service_out(s)

    return await run(ctx, fn)


@router.post("/services/defaults")
async def add_default_services(ctx: RequestContext = Depends(dashboard_context)) -> list[dict[str, Any]]:
    """Add the business's vertical's standard services that it doesn't have yet."""
    require_admin(ctx)

    async def fn(session: AsyncSession) -> list[dict[str, Any]]:
        settings = await session.get(BusinessSettings, ctx.business_id)
        vertical = get_vertical(settings.vertical if settings else None)
        existing = set(
            (await session.scalars(select(func.lower(Service.name)).where(Service.business_id == ctx.business_id))).all()
        )
        added = []
        for d in vertical.default_services:
            if d.name.lower() in existing:
                continue
            s = Service(
                business_id=ctx.business_id, name=d.name, duration_min=d.duration_min,
                buffer_before_min=d.buffer_before_min, buffer_after_min=d.buffer_after_min,
                required_skills=list(d.required_skills),
            )
            session.add(s)
            added.append(s)
        await session.flush()
        if added:
            audit(session, ctx.business_id, ctx.actor, "service.defaults", "service", None, names=[s.name for s in added])
        return [service_out(s) for s in added]

    return await run(ctx, fn)
