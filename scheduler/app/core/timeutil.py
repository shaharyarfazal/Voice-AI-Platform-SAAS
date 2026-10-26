"""Business-local time: parsing what the agent sends, and phrasing times the way a person says them."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..errors import ApiError

LOCAL_SLOT = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$")

# Local-time windows for "morning" etc., in minutes after midnight.
NAMED_WINDOWS = {
    "morning": (6 * 60, 12 * 60),
    "afternoon": (12 * 60, 17 * 60),
    "evening": (17 * 60, 21 * 60),
    "any": (0, 24 * 60),
}


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise ApiError("invalid_timezone", f"Unknown time zone {name!r}.") from e


def parse_local_slot(value: str, tz: ZoneInfo) -> datetime:
    """'YYYY-MM-DDTHH:MM' in business-local time → aware UTC datetime. Full ISO with an offset is
    also accepted."""
    value = value.strip()
    m = LOCAL_SLOT.match(value)
    if m:
        year, month, day, hour, minute = map(int, m.groups())
        try:
            return datetime(year, month, day, hour, minute, tzinfo=tz).astimezone(UTC)
        except ValueError as e:
            raise ApiError("invalid_slot", "That time isn't valid. Use a time from check_availability.") from e
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as e:
        raise ApiError("invalid_slot", "That time isn't valid. Use a time from check_availability.") from e
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(UTC)


def parse_local_date(value: str) -> date:
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError as e:
        raise ApiError("invalid_date", "Give the date as YYYY-MM-DD.") from e


def slot_id(start: datetime, tz: ZoneInfo) -> str:
    return start.astimezone(tz).strftime("%Y-%m-%dT%H:%M")


def _clock(dt: datetime) -> str:
    return dt.strftime("%I:%M").lstrip("0")


def _ampm(dt: datetime) -> str:
    return dt.strftime("%p")


def clock(dt: datetime) -> str:
    """'9:00 AM'."""
    return f"{_clock(dt)} {_ampm(dt)}"


def day_label(dt: datetime, now: datetime | None = None) -> str:
    """'today', 'tomorrow' or 'Thursday, October 16' (local)."""
    if now is not None:
        delta = (dt.date() - now.astimezone(dt.tzinfo).date()).days
        if delta == 0:
            return "today"
        if delta == 1:
            return "tomorrow"
    return f"{dt.strftime('%A, %B')} {dt.day}"


def range_label(start: datetime, end: datetime, tz: ZoneInfo, now: datetime | None = None) -> str:
    """'Thursday, October 16, 9:00–10:30 AM' in local time."""
    s, e = start.astimezone(tz), end.astimezone(tz)
    if _ampm(s) == _ampm(e) and s.date() == e.date():
        span = f"{_clock(s)}–{_clock(e)} {_ampm(e)}"
    else:
        span = f"{clock(s)}–{clock(e)}"
    return f"{day_label(s, now)}, {span}"


def time_window_phrase(start: datetime, end: datetime, tz: ZoneInfo) -> str:
    """'between 9:00 and 10:30 AM'."""
    s, e = start.astimezone(tz), end.astimezone(tz)
    if _ampm(s) == _ampm(e):
        return f"between {_clock(s)} and {_clock(e)} {_ampm(e)}"
    return f"between {clock(s)} and {clock(e)}"


def spoken_start(start: datetime, tz: ZoneInfo, now: datetime | None = None) -> str:
    """'Thursday, October 16 at 9:00 AM'."""
    s = start.astimezone(tz)
    return f"{day_label(s, now)} at {clock(s)}"


def local_day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=tz).astimezone(UTC)
    nxt = day + timedelta(days=1)
    return start, datetime(nxt.year, nxt.month, nxt.day, tzinfo=tz).astimezone(UTC)


def utcnow() -> datetime:
    return datetime.now(UTC)
