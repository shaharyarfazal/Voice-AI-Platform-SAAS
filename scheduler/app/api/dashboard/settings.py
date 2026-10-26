from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...context import RequestContext
from ...core.audit import audit
from ...core.timeutil import zone
from ...errors import ApiError
from ...models import BusinessSettings
from ...schemas.dashboard import SettingsIn
from ...security.auth import dashboard_context, require_admin
from ...verticals import VERTICALS
from ..deps import run
from .serialize import settings_out

router = APIRouter()


@router.get("/settings")
async def get_settings_(ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        s = await session.get(BusinessSettings, ctx.business_id)
        return settings_out(s, configured=s is not None)

    return await run(ctx, fn)


@router.put("/settings")
async def put_settings(body: SettingsIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    require_admin(ctx)
    zone(body.timezone)
    if body.vertical not in VERTICALS:
        raise ApiError("invalid_vertical", f"Unknown vertical {body.vertical!r}.")

    async def fn(session: AsyncSession) -> dict[str, Any]:
        values = body.model_dump()
        await session.execute(
            insert(BusinessSettings)
            .values(business_id=ctx.business_id, **values)
            .on_conflict_do_update(index_elements=[BusinessSettings.business_id], set_=values)
        )
        audit(session, ctx.business_id, ctx.actor, "settings.update", "business_settings", ctx.business_id, **values)
        s = await session.get(BusinessSettings, ctx.business_id, populate_existing=True)
        return settings_out(s)

    return await run(ctx, fn)


@router.get("/verticals")
async def list_verticals(ctx: RequestContext = Depends(dashboard_context)) -> list[dict[str, Any]]:
    return [
        {
            "key": v.key,
            "name": v.name,
            "labels": v.labels,
            "skills": list(v.skills),
            "default_services": [s.name for s in v.default_services],
            "details_schema": v.details_model.model_json_schema(),
        }
        for v in VERTICALS.values()
    ]
