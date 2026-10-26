"""HTTP for connectors: one place for timeouts, retries with exponential backoff and jitter,
provider rate limits (Retry-After) and the mapping of failures to ConnectorError."""

from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx
import structlog

from .base import ConnectorError, CursorExpired, NotFound

log = structlog.get_logger("scheduler.connectors.http")

# Tests replace this with httpx.MockTransport to stand in for the provider.
TRANSPORT: httpx.AsyncBaseTransport | None = None
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4
# First retry wait in seconds (doubles each time); tests set it to 0.
BASE_DELAY = 0.5


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0), transport=TRANSPORT)


def _retry_after(res: httpx.Response) -> float | None:
    try:
        return float(res.headers["retry-after"])
    except (KeyError, ValueError):
        return None


async def request(
    method: str, url: str, *, provider: str, access_token: str | None = None, attempts: int = MAX_ATTEMPTS, **kwargs: Any
) -> httpx.Response:
    """Send, retrying transient failures in place (short waits only; long backoff belongs to the job
    queue). Returns 2xx responses; raises ConnectorError otherwise."""
    headers = dict(kwargs.pop("headers", {}) or {})
    if access_token:
        headers["authorization"] = f"Bearer {access_token}"
    last: ConnectorError | None = None
    async with client() as c:
        for attempt in range(1, attempts + 1):
            try:
                res = await c.request(method, url, headers=headers, **kwargs)
            except httpx.HTTPError as e:
                last = ConnectorError(f"{provider}: {type(e).__name__}", retryable=True)
            else:
                if res.status_code < 300:
                    return res
                last = _error(provider, res)
                if not last.retryable:
                    raise last
            if attempt < attempts:
                wait = min(8.0, (last.retry_after or BASE_DELAY * 2 ** (attempt - 1))) * (0.8 + random.random() * 0.4)
                log.info("connector.retry", provider=provider, attempt=attempt, wait=round(wait, 2), error=str(last))
                await asyncio.sleep(wait)
    assert last is not None
    raise last


def _error(provider: str, res: httpx.Response) -> ConnectorError:
    status = res.status_code
    try:
        body = res.json()
    except ValueError:
        body = {}
    reason = ""
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            reason = str(err.get("message") or err.get("status") or "")
            errors = err.get("errors") or []
            if errors and isinstance(errors[0], dict):
                reason = f"{errors[0].get('reason', '')}: {reason}"
        elif isinstance(err, str):
            reason = f"{err}: {body.get('error_description', '')}"
    message = f"{provider} HTTP {status} {reason}".strip()
    if status == 410:
        return CursorExpired()
    if status == 404:
        return NotFound(message)
    if status == 401 or (status == 400 and "invalid_grant" in reason):
        return ConnectorError(message, retryable=False, needs_reauth=True, status=status)
    # Google reports quota/rate limits as 403 with these reasons.
    if status == 403 and any(r in reason for r in ("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded")):
        return ConnectorError(message, retryable=True, status=429, retry_after=_retry_after(res))
    if status == 403 and "insufficientPermissions" in reason:
        return ConnectorError(message, retryable=False, needs_reauth=True, status=status)
    return ConnectorError(message, retryable=status in RETRY_STATUSES, status=status, retry_after=_retry_after(res))
