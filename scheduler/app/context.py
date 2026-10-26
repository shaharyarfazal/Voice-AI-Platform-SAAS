from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field


@dataclass
class Actor:
    """Who is acting, for audit and booking history."""

    type: str  # "agent" | "api_key" | "user" | "system"
    id: str | None = None


@dataclass
class RequestContext:
    business_id: uuid.UUID
    actor: Actor
    role: str = "member"  # dashboard role: member | admin | owner
    # Run after the request's transaction commits (e.g. enqueue calendar sync), never before.
    after_commit: list[Callable[[], Awaitable[None]]] = field(default_factory=list)
