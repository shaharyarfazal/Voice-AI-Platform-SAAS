"""Calendar connections: connect (OAuth), choose calendars, disconnect, notifications, sync failures."""

from __future__ import annotations

import hmac
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import metrics
from ..config import get_settings
from ..connectors import ConnectorError, connector_for, providers
from ..context import Actor, RequestContext
from ..core import booking as engine
from ..core.audit import audit, booking_event
from ..core.settings import load_settings
from ..core.timeutil import utcnow
from ..db import tenant_session, worker_session
from ..errors import ApiError
from ..models import (
    Booking,
    ConnectedAccount,
    ExternalBusyBlock,
    ExternalCalendar,
    Staff,
    SyncFailure,
    SyncState,
)
from ..security.auth import dashboard_context, require_admin
from ..sync import calendar_sync, connect, signed
from ..worker.queue import enqueue
from .deps import run

dashboard = APIRouter(prefix="/v1", tags=["dashboard"])
internal = APIRouter(include_in_schema=False)

STATE_TTL = 15 * 60
INVITE_TTL = 7 * 24 * 3600


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class AuthorizeIn(_In):
    staff_id: uuid.UUID
    redirect_uri: str = Field(max_length=500)


class InviteIn(_In):
    staff_id: uuid.UUID
    provider: str


class InviteAuthorizeIn(_In):
    invite: str = Field(max_length=2000)
    redirect_uri: str = Field(max_length=500)


class CallbackIn(_In):
    code: str = Field(max_length=2000)
    state: str = Field(max_length=2000)
    nonce: str = Field(max_length=200)
    redirect_uri: str = Field(max_length=500)


class CalendarPatch(_In):
    use_for_busy: bool | None = None
    write_bookings_here: bool | None = None


class ExternalChangeIn(_In):
    action: Literal["keep", "revert", "restore", "cancel"]


def _provider(provider: str) -> str:
    if provider not in providers():
        raise ApiError("unknown_provider", f"Unknown calendar provider {provider!r}.", status=404)
    return provider


def _check_redirect(uri: str) -> None:
    if not uri.startswith(get_settings().app_url.rstrip("/") + "/"):
        raise ApiError("invalid_redirect", "The redirect address must be on this app's domain.")


def _internal(request: Request) -> None:
    token = get_settings().internal_api_token
    header = request.headers.get("authorization", "")
    if not token or not hmac.compare_digest(header, f"Bearer {token}"):
        raise ApiError("unauthorized", "Missing or invalid credentials.", status=401)


def _authorize(provider: str, business_id: uuid.UUID, staff_id: uuid.UUID, redirect_uri: str, via: str) -> dict[str, str]:
    _check_redirect(redirect_uri)
    nonce = secrets.token_urlsafe(16)
    state = signed.sign("oauth", {"bid": str(business_id), "sid": str(staff_id), "prv": provider, "n": nonce, "via": via}, STATE_TTL)
    try:
        url = connector_for(provider).get_oauth_url(state, redirect_uri)
    except ConnectorError as e:
        raise ApiError("not_configured", str(e), status=503) from e
    return {"url": url, "nonce": nonce}


async def _staff(session: AsyncSession, business_id: uuid.UUID, staff_id: uuid.UUID) -> Staff:
    staff = await session.scalar(select(Staff).where(Staff.business_id == business_id, Staff.id == staff_id))
    if staff is None:
        raise ApiError("not_found", "No such team member.", status=404)
    return staff


# ── dashboard ────────────────────────────────────────────────────────────────


@dashboard.get("/connections")
async def list_connections(ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        accounts = (await session.scalars(select(ConnectedAccount).where(ConnectedAccount.business_id == ctx.business_id).order_by(ConnectedAccount.created_at))).all()
        calendars = (await session.scalars(select(ExternalCalendar).where(ExternalCalendar.business_id == ctx.business_id).order_by(ExternalCalendar.is_primary.desc(), ExternalCalendar.name))).all()
        states = {s.external_calendar_id: s for s in (await session.scalars(select(SyncState).where(SyncState.business_id == ctx.business_id))).all()}
        failures = (
            await session.scalars(
                select(SyncFailure).where(SyncFailure.business_id == ctx.business_id, SyncFailure.status != "resolved").order_by(SyncFailure.updated_at.desc()).limit(100)
            )
        ).all()
        out = []
        for a in accounts:
            cals = []
            for c in calendars:
                if c.connected_account_id != a.id:
                    continue
                st = states.get(c.id)
                cals.append({
                    "id": str(c.id), "name": c.name, "is_primary": c.is_primary, "writable": c.writable,
                    "use_for_busy": c.use_for_busy, "write_bookings_here": c.write_bookings_here,
                    "last_synced_at": st.last_incremental_at.isoformat() if st and st.last_incremental_at else None,
                    "notifications": bool(st and st.channel_id),
                    "last_error": st.last_error if st else None,
                })
            out.append({
                "id": str(a.id), "staff_id": str(a.staff_id) if a.staff_id else None, "provider": a.provider,
                "email": a.external_email, "status": a.status, "last_error": a.last_error,
                "last_sync_at": a.last_sync_at.isoformat() if a.last_sync_at else None, "calendars": cals,
            })
        return {
            "providers": [p for p in providers() if connector_for(p).one_tap and _configured(p)],
            "accounts": out,
            "failures": [
                {"id": str(f.id), "booking_id": str(f.booking_id) if f.booking_id else None, "operation": f.operation,
                 "attempts": f.attempts, "last_error": f.last_error, "status": f.status, "updated_at": f.updated_at.isoformat()}
                for f in failures
            ],
        }

    return await run(ctx, fn)


def _configured(provider: str) -> bool:
    s = get_settings()
    return bool({"google": s.google_client_id, "microsoft": s.microsoft_client_id}.get(provider))


@dashboard.post("/connections/{provider}/authorize")
async def authorize(provider: str, body: AuthorizeIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, str]:
    """Start one-tap connect for a team member (an owner or admin connecting on their behalf)."""
    require_admin(ctx)
    _provider(provider)

    async def fn(session: AsyncSession) -> dict[str, str]:
        await _staff(session, ctx.business_id, body.staff_id)
        return _authorize(provider, ctx.business_id, body.staff_id, body.redirect_uri, f"user:{ctx.actor.id}")

    return await run(ctx, fn)


@dashboard.post("/connections/invite")
async def invite(body: InviteIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, str]:
    """A link the team member opens themselves to connect their own calendar (valid 7 days)."""
    require_admin(ctx)
    _provider(body.provider)

    async def fn(session: AsyncSession) -> dict[str, str]:
        staff = await _staff(session, ctx.business_id, body.staff_id)
        token = signed.sign("invite", {"bid": str(ctx.business_id), "sid": str(staff.id), "prv": body.provider}, INVITE_TTL)
        audit(session, ctx.business_id, ctx.actor, "connection.invite", "staff", staff.id, provider=body.provider)
        return {"token": token, "expires_at": (datetime.now(UTC) + timedelta(seconds=INVITE_TTL)).isoformat()}

    return await run(ctx, fn)


@dashboard.patch("/connections/calendars/{calendar_id}")
async def update_calendar(calendar_id: uuid.UUID, body: CalendarPatch, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    """Choose which calendars count as busy and which one receives the jobs."""
    require_admin(ctx)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        cal = await session.scalar(select(ExternalCalendar).where(ExternalCalendar.business_id == ctx.business_id, ExternalCalendar.id == calendar_id))
        if cal is None:
            raise ApiError("not_found", "No such calendar.", status=404)
        moved_jobs = False
        if body.write_bookings_here is not None and body.write_bookings_here != cal.write_bookings_here:
            if body.write_bookings_here:
                if not cal.writable:
                    raise ApiError("read_only_calendar", "That calendar is read-only; choose one you can edit.")
                others = (await session.scalars(select(ExternalCalendar).where(ExternalCalendar.staff_id == cal.staff_id, ExternalCalendar.write_bookings_here))).all()
                for other in others:
                    other.write_bookings_here = False
                await session.flush()
            cal.write_bookings_here = body.write_bookings_here
            moved_jobs = True
        if body.use_for_busy is not None:
            cal.use_for_busy = body.use_for_busy
        await session.flush()
        if not calendar_sync.synced(cal):
            await session.execute(delete(ExternalBusyBlock).where(ExternalBusyBlock.external_calendar_id == cal.id))
        audit(session, ctx.business_id, ctx.actor, "connection.calendar", "external_calendar", cal.id, **body.model_dump(exclude_none=True))

        async def after() -> None:
            await enqueue("sync_calendar", str(cal.id), True)
            await enqueue("ensure_channel", str(cal.id))

        ctx.after_commit.append(after)
        if moved_jobs:
            # Put the person's upcoming jobs on the calendar they now go to.
            upcoming = (
                await session.scalars(
                    select(Booking.id).where(
                        Booking.business_id == ctx.business_id, Booking.staff_id == cal.staff_id, Booking.status == "confirmed",
                        func.upper(Booking.time_range) > utcnow(),
                    )
                )
            ).all()
            for booking_id in upcoming:
                engine.after_commit_push(ctx, booking_id, "update")
        return {"id": str(cal.id), "use_for_busy": cal.use_for_busy, "write_bookings_here": cal.write_bookings_here}

    return await run(ctx, fn)


@dashboard.post("/connections/{account_id}/sync")
async def sync_now(account_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        ids = (
            await session.scalars(
                select(ExternalCalendar.id).where(ExternalCalendar.business_id == ctx.business_id, ExternalCalendar.connected_account_id == account_id)
            )
        ).all()
        if not ids:
            raise ApiError("not_found", "No such connection.", status=404)

        async def after() -> None:
            for cal_id in ids:
                await enqueue("sync_calendar", str(cal_id), True)

        ctx.after_commit.append(after)
        return {"ok": True, "calendars": len(ids)}

    return await run(ctx, fn)


@dashboard.delete("/connections/{account_id}", status_code=204)
async def disconnect(account_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> None:
    """Disconnect: revoke access, stop notifications, delete cached calendar data."""
    require_admin(ctx)

    async def fn(session: AsyncSession) -> None:
        account = await session.scalar(select(ConnectedAccount).where(ConnectedAccount.business_id == ctx.business_id, ConnectedAccount.id == account_id))
        if account is None:
            raise ApiError("not_found", "No such connection.", status=404)
        await connect.disconnect(session, account, ctx.actor)

    await run(ctx, fn)


@dashboard.post("/sync-failures/{failure_id}/retry")
async def retry_failure(failure_id: uuid.UUID, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    async def fn(session: AsyncSession) -> dict[str, Any]:
        failure = await session.scalar(select(SyncFailure).where(SyncFailure.business_id == ctx.business_id, SyncFailure.id == failure_id))
        if failure is None or failure.booking_id is None:
            raise ApiError("not_found", "No such failure.", status=404)
        failure.status = "retrying"
        await session.flush()
        engine.after_commit_push(ctx, failure.booking_id, "retry")
        return {"ok": True}

    return await run(ctx, fn)


@dashboard.post("/bookings/{booking_id}/external-change")
async def resolve_external_change(booking_id: uuid.UUID, body: ExternalChangeIn, ctx: RequestContext = Depends(dashboard_context)) -> dict[str, Any]:
    """Review a change made in someone's calendar: keep it, revert the job to its earlier time, put our
    event back as it was, or cancel the job."""

    async def fn(session: AsyncSession) -> dict[str, Any]:
        settings = await load_settings(session, ctx.business_id)
        b = await engine.lock_booking(session, ctx.business_id, booking_id)
        change = b.external_change
        if not change:
            raise ApiError("nothing_to_review", "This job has no calendar change to review.", status=409)
        if body.action == "revert":
            if change.get("kind") != "moved" or not change.get("applied"):
                raise ApiError("cannot_revert", "Only a move that was applied can be reverted.", status=409)
            await engine.reschedule(
                session, ctx, settings=settings, booking=b, new_start=datetime.fromisoformat(change["from"]), now=utcnow(),
                staff_ids=[b.staff_id], respect_hours=False,
            )
        elif body.action == "restore":
            engine.after_commit_push(ctx, b.id, "restore")
        elif body.action == "cancel":
            await engine.cancel(session, ctx, booking=b, reason=f"Removed from the technician's calendar ({change.get('provider')})")
        b.external_change = None
        b.version += 1
        await session.flush()
        booking_event(session, business_id=ctx.business_id, booking_id=b.id, kind="external_change_reviewed", actor=ctx.actor, action=body.action)
        audit(session, ctx.business_id, ctx.actor, "booking.external_change_reviewed", "booking", b.id, review=body.action)
        return {"ok": True, "status": b.status}

    return await run(ctx, fn)


# ── called by the web app's server (OAuth redirects and provider notifications) ───────────────


@internal.post("/connect/{provider}/authorize-invite")
async def authorize_invite(provider: str, body: InviteAuthorizeIn, request: Request) -> dict[str, str]:
    _internal(request)
    data = signed.verify("invite", body.invite)
    if data["prv"] != _provider(provider):
        raise ApiError("invalid_link", "This link is for a different calendar provider.")
    business_id, staff_id = uuid.UUID(data["bid"]), uuid.UUID(data["sid"])
    async with tenant_session(business_id) as session:
        staff = await _staff(session, business_id, staff_id)
        name = staff.name
    return {**_authorize(provider, business_id, staff_id, body.redirect_uri, "invite"), "staff_name": name}


@internal.post("/connect/{provider}/callback")
async def oauth_callback(provider: str, body: CallbackIn, request: Request) -> dict[str, Any]:
    """Finish connecting. The state proves which business and person this is for, and the nonce that
    it's the same browser that started the flow."""
    _internal(request)
    data = signed.verify("oauth", body.state)
    if data["prv"] != _provider(provider) or not hmac.compare_digest(str(data.get("n", "")), body.nonce):
        raise ApiError("invalid_link", "This sign-in didn't start here. Start connecting again.")
    _check_redirect(body.redirect_uri)
    business_id, staff_id = uuid.UUID(data["bid"]), uuid.UUID(data["sid"])
    via = str(data.get("via", ""))
    actor = Actor("user", via.removeprefix("user:")) if via.startswith("user:") else Actor("system", "invite")
    ctx = RequestContext(business_id=business_id, actor=actor)

    async def fn(session: AsyncSession) -> dict[str, Any]:
        account = await connect.complete_connection(
            session, business_id=business_id, staff_id=staff_id, provider=provider, code=body.code,
            redirect_uri=body.redirect_uri, actor=actor,
        )
        staff = await session.get(Staff, staff_id)

        async def after() -> None:
            await enqueue("initial_sync", str(account.id))

        ctx.after_commit.append(after)
        return {"ok": True, "staff_name": staff.name if staff else "", "email": account.external_email, "via": "invite" if via == "invite" else "user"}

    return await run(ctx, fn)


@internal.post("/webhooks/{provider}")
async def webhook(provider: str, request: Request) -> Response:
    """A provider says a calendar changed. Verified against the channel's secret, acknowledged at once;
    the sync runs in the background."""
    _internal(request)
    connector = connector_for(_provider(provider))
    info = connector.handle_webhook(dict(request.headers), await request.body())
    async with worker_session() as session:
        calendar_id = await calendar_sync.calendar_for_channel(session, info.get("channel_id", ""), info.get("token", ""))
    if calendar_id is None:
        metrics.WEBHOOKS.labels(provider, "rejected").inc()
        return Response(status_code=404)
    if info.get("state") == "sync":
        # The handshake Google sends when a channel opens.
        metrics.WEBHOOKS.labels(provider, "handshake").inc()
        return Response(status_code=200)
    metrics.WEBHOOKS.labels(provider, "accepted").inc()
    # Bursts of notifications for one calendar collapse into one sync per few seconds.
    await enqueue("sync_calendar", str(calendar_id), job_id=f"sync:{calendar_id}:{int(time.time()) // 5}")
    return Response(status_code=200)
