"""Who is calling, and for which business.

- Our voice agent: `Authorization: Bearer <INTERNAL_API_TOKEN>` + `X-Agent-Id` (the business is the
  agent's tenant).
- Other voice agents / integrations: `Authorization: Bearer vk_…`, a workspace API key from the web
  app (only its SHA-256 hash is stored).
- Dashboard: `Authorization: Bearer <JWT>` minted for 60s by the web app's proxy after it checked the
  user's session, signed with SCHED_JWT_SECRET.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid

import jwt
from fastapi import Request
from sqlalchemy import text

from ..config import get_settings
from ..context import Actor, RequestContext
from ..db import sessionmaker
from ..errors import ApiError

_UNAUTHORIZED = ApiError("unauthorized", "Missing or invalid credentials.", status=401)


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


async def _lookup(sql: str, **params: str) -> tuple | None:
    # Auth runs before a tenant is known, so it reads the web app's tables (granted read-only).
    async with sessionmaker("app")() as session:
        return (await session.execute(text(sql), params)).first()


async def agent_context(request: Request) -> RequestContext:
    token = _bearer(request)
    settings = get_settings()
    if not token:
        raise _UNAUTHORIZED
    if settings.internal_api_token and hmac.compare_digest(token, settings.internal_api_token):
        agent_id = request.headers.get("x-agent-id", "")
        try:
            agent_uuid = uuid.UUID(agent_id)
        except ValueError as e:
            raise ApiError("unauthorized", "X-Agent-Id is required.", status=401) from e
        row = await _lookup(
            "SELECT a.tenant_id FROM public.agents a JOIN public.tenants t ON t.id = a.tenant_id "
            "WHERE a.id = :id AND t.status = 'active'",
            id=str(agent_uuid),
        )
        if row is None:
            raise _UNAUTHORIZED
        return RequestContext(business_id=row[0], actor=Actor("agent", str(agent_uuid)))
    if token.startswith("vk_") and len(token) <= 100:
        row = await _lookup(
            "SELECT k.id, k.tenant_id FROM public.api_keys k JOIN public.tenants t ON t.id = k.tenant_id "
            "WHERE k.key_hash = :hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now()) "
            "AND t.status = 'active'",
            hash=hashlib.sha256(token.encode()).hexdigest(),
        )
        if row is None:
            raise _UNAUTHORIZED
        return RequestContext(business_id=row[1], actor=Actor("api_key", str(row[0])))
    raise _UNAUTHORIZED


async def dashboard_context(request: Request) -> RequestContext:
    secret = get_settings().sched_jwt_secret
    token = _bearer(request)
    if not secret or not token:
        raise _UNAUTHORIZED
    try:
        claims = jwt.decode(
            token, secret, algorithms=["HS256"], audience="sched", options={"require": ["exp", "sub", "bid", "aud"]}
        )
        business_id = uuid.UUID(claims["bid"])
    except (jwt.PyJWTError, ValueError, KeyError) as e:
        raise _UNAUTHORIZED from e
    role = claims.get("role", "member")
    if role not in ("member", "admin", "owner"):
        raise _UNAUTHORIZED
    return RequestContext(business_id=business_id, actor=Actor("user", str(claims["sub"])), role=role)


def require_admin(ctx: RequestContext) -> None:
    if ctx.role not in ("admin", "owner"):
        raise ApiError("forbidden", "Only workspace owners and admins can change this.", status=403)
