from .base import DefaultService, VerticalPack
from .generic import GENERIC
from .hvac import HVAC

VERTICALS: dict[str, VerticalPack] = {p.key: p for p in (GENERIC, HVAC)}


def get_vertical(key: str | None) -> VerticalPack:
    return VERTICALS.get(key or "", GENERIC)


__all__ = ["VERTICALS", "DefaultService", "VerticalPack", "get_vertical"]
