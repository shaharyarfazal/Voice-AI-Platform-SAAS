from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """An error the caller can act on. `code` is stable; `message` is safe to read aloud to a caller."""

    def __init__(self, code: str, message: str, status: int = 400, *, keep_changes: bool = False, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        # Commit the transaction's writes even though the request failed (e.g. a released hold).
        self.keep_changes = keep_changes
        self.extra = extra

    def body(self) -> dict[str, Any]:
        return {"ok": False, "code": self.code, "message": self.message, **self.extra}


def is_exclusion_violation(exc: BaseException) -> bool:
    """True for Postgres 23P01: the bookings exclusion constraint rejected an overlapping booking."""
    for candidate in (getattr(exc, "orig", None), getattr(getattr(exc, "orig", None), "__cause__", None)):
        if candidate is not None and getattr(candidate, "sqlstate", None) == "23P01":
            return True
    return False
