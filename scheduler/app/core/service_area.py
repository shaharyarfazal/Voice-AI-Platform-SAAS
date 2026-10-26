"""Which postal codes a business and its staff cover. Phase 1 matches postal codes; radius coverage
with geocoding comes later."""

from __future__ import annotations

import re
from typing import Any

# US ZIP (5 or 9 digits), Canadian (A1A 1A1) and UK-style outward codes are the common cases.
_US = re.compile(r"\b(\d{5})(?:-\d{4})?\b")
_CA = re.compile(r"\b([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\b")


def normalize_postal(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().upper()
    if m := _CA.fullmatch(value):
        return f"{m.group(1).upper()} {m.group(2).upper()}"
    if m := _US.fullmatch(value):
        return m.group(1)
    return value or None


def postal_from_address(address: str | None) -> str | None:
    """The postal code in a free-text address (the last one, since house numbers come first)."""
    if not address:
        return None
    if ca := list(_CA.finditer(address)):
        m = ca[-1]
        return f"{m.group(1).upper()} {m.group(2).upper()}"
    us = list(_US.finditer(address))
    # A 5-digit house number at the start isn't a ZIP code.
    if us and not (len(us) == 1 and us[0].start() == 0 and len(address.strip()) > 5):
        return us[-1].group(1)
    return None


def business_covers(service_area: dict[str, Any], postal: str | None) -> bool:
    codes = [normalize_postal(c) for c in (service_area or {}).get("postal_codes") or []]
    if not codes or postal is None:
        return True
    return normalize_postal(postal) in codes
