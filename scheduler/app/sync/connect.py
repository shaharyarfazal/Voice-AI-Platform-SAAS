"""Connecting and disconnecting a staff member's calendar account."""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors import ConnectorError, connector_for
from ..context import Actor
from ..core.audit import audit
from ..errors import ApiError
from ..models import ConnectedAccount, ExternalCalendar, Staff, SyncState
from ..security.crypto import decrypt, encrypt
from .calendar_sync import stop_channel

log = structlog.get_logger("scheduler.sync.connect")


async def complete_connection(
    session: AsyncSession, *, business_id: uuid.UUID, staff_id: uuid.UUID, provider: str, code: str, redirect_uri: str, actor: Actor
) -> ConnectedAccount:
    staff = await session.scalar(select(Staff).where(Staff.business_id == business_id, Staff.id == staff_id))
    if staff is None:
        raise ApiError("not_found", "That team member no longer exists.", status=404)
    connector = connector_for(provider)
    try:
        tokens = await connector.handle_oauth_callback(code, redirect_uri)
        calendars = await connector.list_calendars(tokens.access_token)
    except ConnectorError as e:
        raise ApiError("connect_failed", f"Couldn't connect the calendar: {e}", status=400) from e

    account = await session.scalar(
        select(ConnectedAccount).where(
            ConnectedAccount.staff_id == staff_id, ConnectedAccount.provider == provider,
            func.lower(ConnectedAccount.external_email) == tokens.account_email.lower(),
        )
    )
    new = account is None
    if account is None:
        account = ConnectedAccount(business_id=business_id, staff_id=staff_id, provider=provider, kind="calendar", external_email=tokens.account_email)
        session.add(account)
    account.access_token_enc = encrypt(tokens.access_token)
    account.refresh_token_enc = encrypt(tokens.refresh_token) if tokens.refresh_token else account.refresh_token_enc
    account.token_expires_at = tokens.expires_at
    account.scopes = list(tokens.scopes)
    account.status = "active"
    account.last_error = None
    await session.flush()

    has_write_calendar = await session.scalar(
        select(func.count()).select_from(ExternalCalendar).where(ExternalCalendar.staff_id == staff_id, ExternalCalendar.write_bookings_here)
    )
    existing = {
        c.external_calendar_id: c
        for c in (await session.scalars(select(ExternalCalendar).where(ExternalCalendar.connected_account_id == account.id))).all()
    }
    for item in calendars:
        cal = existing.get(item.external_id)
        if cal is None:
            # Default: the primary calendar is checked for busy time and receives the jobs.
            write = item.primary and item.writable and not has_write_calendar
            cal = ExternalCalendar(
                business_id=business_id, connected_account_id=account.id, staff_id=staff_id,
                external_calendar_id=item.external_id, use_for_busy=item.primary, write_bookings_here=write,
            )
            session.add(cal)
            has_write_calendar = has_write_calendar or write
        cal.name = item.name
        cal.timezone = item.timezone
        cal.is_primary = item.primary
        cal.writable = item.writable
        if not item.writable:
            cal.write_bookings_here = False
    await session.flush()
    audit(session, business_id, actor, "connection.connect" if new else "connection.reconnect", "connected_account", account.id,
          provider=provider, staff_id=staff_id, email=tokens.account_email, calendars=len(calendars))
    log.info("connection.connected", account_id=str(account.id), provider=provider, calendars=len(calendars))
    return account


async def disconnect(session: AsyncSession, account: ConnectedAccount, actor: Actor) -> None:
    """Revoke our access at the provider, stop notifications and delete everything we cached from the
    account (calendars, busy time, sync state, event links). Events already written stay in the
    person's calendar."""
    calendars = (await session.scalars(select(ExternalCalendar).where(ExternalCalendar.connected_account_id == account.id))).all()
    for cal in calendars:
        state = await session.get(SyncState, cal.id)
        if state is not None and account.status == "active":
            await stop_channel(session, account, state)
    connector = connector_for(account.provider)
    for token_enc in (account.refresh_token_enc, account.access_token_enc):
        if not token_enc:
            continue
        try:
            await connector.revoke(decrypt(token_enc))
            break
        except ConnectorError as e:
            log.info("connection.revoke_failed", error=str(e))
    audit(session, account.business_id, actor, "connection.disconnect", "connected_account", account.id,
          provider=account.provider, staff_id=account.staff_id, email=account.external_email)
    # Cascades to calendars, busy blocks, links and sync state.
    await session.delete(account)
    await session.flush()
