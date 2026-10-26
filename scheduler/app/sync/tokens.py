from __future__ import annotations

from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from ..connectors import ConnectorError, connector_for
from ..context import Actor
from ..core.audit import audit
from ..models import ConnectedAccount
from ..security.crypto import decrypt, encrypt

log = structlog.get_logger("scheduler.sync.tokens")
REFRESH_MARGIN = timedelta(minutes=2)


class NeedsReauth(ConnectorError):
    def __init__(self, message: str) -> None:
        super().__init__(message, retryable=False, needs_reauth=True)


async def mark_needs_reauth(session: AsyncSession, account: ConnectedAccount, error: str) -> None:
    """Access was revoked or expired for good: stop using the account until it's reconnected. With the
    business's default rule, the staff member is treated as unavailable for automatic booking."""
    if account.status == "needs_reauth":
        return
    account.status = "needs_reauth"
    account.last_error = error[:500]
    await session.flush()
    audit(session, account.business_id, Actor("system", "sync"), "connection.needs_reauth", "connected_account", account.id,
          provider=account.provider, staff_id=account.staff_id, error=error[:500])
    log.warning("connection.needs_reauth", account_id=str(account.id), provider=account.provider)


async def access_token(session: AsyncSession, account: ConnectedAccount) -> str:
    """A valid access token, refreshed if it's about to expire."""
    if account.status != "active":
        raise NeedsReauth(f"{account.provider} account {account.external_email} needs to be reconnected")
    if account.token_expires_at > datetime.now(UTC) + REFRESH_MARGIN:
        return decrypt(account.access_token_enc)
    if not account.refresh_token_enc:
        await mark_needs_reauth(session, account, "no refresh token")
        raise NeedsReauth("no refresh token")
    connector = connector_for(account.provider)
    try:
        tokens = await connector.refresh_token(decrypt(account.refresh_token_enc))
    except ConnectorError as e:
        if e.needs_reauth:
            await mark_needs_reauth(session, account, str(e))
        raise
    account.access_token_enc = encrypt(tokens.access_token)
    account.token_expires_at = tokens.expires_at
    if tokens.refresh_token:
        account.refresh_token_enc = encrypt(tokens.refresh_token)
    account.last_error = None
    await session.flush()
    return tokens.access_token
