"""Background jobs (arq). Every job is safe to run twice."""

from __future__ import annotations

import random
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from arq import Retry
from sqlalchemy import select

from .. import metrics
from ..connectors import ConnectorError
from ..core.booking import expire_holds
from ..core.timeutil import utcnow
from ..db import worker_session
from ..models import ConnectedAccount, ExternalCalendar, SyncState
from ..sync import calendar_sync, push
from ..sync.tokens import access_token

log = structlog.get_logger("scheduler.worker")
MAX_TRIES = 6


def backoff(job_try: int) -> float:
    """Exponential with jitter: ~10s, 20s, 40s, 80s, 160s."""
    return min(600.0, 10.0 * 2 ** (job_try - 1)) * (0.75 + random.random() * 0.5)


async def _after(ctx: Any) -> None:
    """Run what a sync scheduled for after its commit (e.g. the calendar write for an applied move)."""
    if ctx is None:
        return
    for hook in ctx.after_commit:
        await hook()


async def expire_holds_job(_ctx: dict[str, Any]) -> int:
    async with worker_session() as session:
        count = await expire_holds(session, utcnow())
    if count:
        log.info("holds.expired", count=count)
    return count


async def push_booking(ctx: dict[str, Any], business_id: str, booking_id: str, operation: str) -> str:
    """Write the job's event to the assigned person's calendar, with retries and backoff; after the
    last try it goes to the dead-letter queue (dashboard shows it with a retry button)."""
    job_try = ctx.get("job_try", 1)
    try:
        async with worker_session() as session:
            result = await push.push_booking(session, uuid.UUID(booking_id))
        metrics.PUSH.labels("ok").inc()
        return result
    except ConnectorError as e:
        if e.retryable and job_try < MAX_TRIES and not ctx.get("inline"):
            metrics.PUSH.labels("retry").inc()
            raise Retry(defer=e.retry_after or backoff(job_try)) from e
        metrics.PUSH.labels("dead").inc()
        async with worker_session() as session:
            await push.record_failure(session, uuid.UUID(booking_id), e, job_try)
        return f"failed: {e}"


async def sync_calendar(ctx: dict[str, Any], calendar_id: str, full: bool = False) -> str:
    started = time.perf_counter()
    try:
        async with worker_session() as session:
            sync_ctx = await calendar_sync.sync_calendar(session, uuid.UUID(calendar_id), full=full)
    except ConnectorError as e:
        if e.retryable and ctx.get("job_try", 1) < 3 and not ctx.get("inline"):
            raise Retry(defer=e.retry_after or backoff(ctx.get("job_try", 1))) from e
        log.warning("calendar.sync_failed", calendar_id=calendar_id, error=str(e))
        return f"failed: {e}"
    await _after(sync_ctx)
    metrics.SYNC_SECONDS.observe(time.perf_counter() - started)
    return "ok"


async def initial_sync(ctx: dict[str, Any], account_id: str) -> str:
    """After connecting: sync future events of the calendars in use, then turn on notifications."""
    async with worker_session() as session:
        ids = (
            await session.scalars(
                select(ExternalCalendar.id).where(
                    ExternalCalendar.connected_account_id == uuid.UUID(account_id),
                    ExternalCalendar.use_for_busy | ExternalCalendar.write_bookings_here,
                )
            )
        ).all()
    for cal_id in ids:
        await sync_calendar(ctx, str(cal_id), True)
        await ensure_channel(ctx, str(cal_id))
    return f"{len(ids)} calendars"


async def ensure_channel(_ctx: dict[str, Any], calendar_id: str) -> str:
    try:
        async with worker_session() as session:
            await calendar_sync.ensure_channel(session, uuid.UUID(calendar_id))
    except ConnectorError as e:
        # Reconciliation still keeps the cache fresh without notifications; retried by renew_channels.
        log.warning("channel.failed", calendar_id=calendar_id, error=str(e))
        return f"failed: {e}"
    return "ok"


async def renew_channels(ctx: dict[str, Any]) -> int:
    """Notification channels expire (Google: about a week). Renew those expiring within a day, and
    open any that are missing."""
    soon = datetime.now(UTC) + calendar_sync.RENEW_BEFORE
    async with worker_session() as session:
        rows = (
            await session.execute(
                select(ExternalCalendar.id)
                .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
                .outerjoin(SyncState, SyncState.external_calendar_id == ExternalCalendar.id)
                .where(
                    ConnectedAccount.status == "active",
                    ExternalCalendar.use_for_busy | ExternalCalendar.write_bookings_here,
                    (SyncState.channel_id.is_(None)) | (SyncState.channel_expires_at < soon),
                )
            )
        ).scalars().all()
    for cal_id in rows:
        await ensure_channel(ctx, str(cal_id))
    return len(rows)


async def reconcile(ctx: dict[str, Any]) -> int:
    """Safety net for missed notifications: sync every calendar in use."""
    async with worker_session() as session:
        ids = (
            await session.scalars(
                select(ExternalCalendar.id)
                .join(ConnectedAccount, ConnectedAccount.id == ExternalCalendar.connected_account_id)
                .where(ConnectedAccount.status == "active", ExternalCalendar.use_for_busy | ExternalCalendar.write_bookings_here)
            )
        ).all()
    for cal_id in ids:
        await sync_calendar({**ctx, "job_try": 3}, str(cal_id))
    return len(ids)


async def refresh_tokens(_ctx: dict[str, Any]) -> int:
    """Refresh tokens close to expiry. Also how revoked access is noticed between bookings."""
    soon = datetime.now(UTC) + timedelta(minutes=15)
    async with worker_session() as session:
        accounts = (
            await session.scalars(select(ConnectedAccount).where(ConnectedAccount.status == "active", ConnectedAccount.token_expires_at < soon))
        ).all()
        for account in accounts:
            try:
                await access_token(session, account)
            except ConnectorError as e:
                log.warning("token.refresh_failed", account_id=str(account.id), error=str(e))
    return len(accounts)


TASKS = {
    "push_booking": push_booking,
    "sync_calendar": sync_calendar,
    "initial_sync": initial_sync,
    "ensure_channel": ensure_channel,
}
