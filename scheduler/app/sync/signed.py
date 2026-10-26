"""Short signed tokens: OAuth `state` (binds the callback to the business, staff member and the
browser that started it) and technician invite links."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from ..config import get_settings
from ..errors import ApiError


def _key() -> bytes:
    secret = get_settings().sched_jwt_secret
    if not secret:
        raise ApiError("not_configured", "SCHED_JWT_SECRET isn't set.", status=503)
    return hashlib.sha256(f"signed-tokens:{secret}".encode()).digest()


def sign(purpose: str, data: dict[str, Any], ttl_seconds: int) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({**data, "p": purpose, "exp": int(time.time()) + ttl_seconds}, separators=(",", ":")).encode()
    ).rstrip(b"=").decode()
    mac = hmac.new(_key(), payload.encode(), hashlib.sha256).digest()
    return f"{payload}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def verify(purpose: str, token: str) -> dict[str, Any]:
    invalid = ApiError("invalid_link", "This link is invalid or has expired. Ask for a new one.", status=400)
    try:
        payload, mac = token.split(".")
        expected = base64.urlsafe_b64encode(hmac.new(_key(), payload.encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
        if not hmac.compare_digest(expected, mac):
            raise invalid
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError) as e:
        raise invalid from e
    if data.get("p") != purpose or data.get("exp", 0) < time.time():
        raise invalid
    return data


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
