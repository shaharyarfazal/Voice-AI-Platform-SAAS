"""Interval algebra over half-open [start, end) UTC datetimes, and expansion of weekly local working
hours into concrete UTC intervals (DST-safe via zoneinfo)."""

from __future__ import annotations

from bisect import bisect_left
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

Interval = tuple[datetime, datetime]


def normalize(intervals: Iterable[Interval]) -> list[Interval]:
    """Sorted, with overlapping and touching intervals merged and empty ones dropped."""
    out: list[Interval] = []
    for start, end in sorted(i for i in intervals if i[0] < i[1]):
        if out and start <= out[-1][1]:
            if end > out[-1][1]:
                out[-1] = (out[-1][0], end)
        else:
            out.append((start, end))
    return out


def subtract(base: Iterable[Interval], remove: Iterable[Interval]) -> list[Interval]:
    """`base` minus `remove`."""
    result: list[Interval] = []
    removals = normalize(remove)
    for start, end in normalize(base):
        cursor = start
        for r_start, r_end in removals:
            if r_end <= cursor:
                continue
            if r_start >= end:
                break
            if r_start > cursor:
                result.append((cursor, r_start))
            cursor = max(cursor, r_end)
            if cursor >= end:
                break
        if cursor < end:
            result.append((cursor, end))
    return result


def intersect(a: Iterable[Interval], b: Iterable[Interval]) -> list[Interval]:
    a_n, b_n = normalize(a), normalize(b)
    out: list[Interval] = []
    i = j = 0
    while i < len(a_n) and j < len(b_n):
        start = max(a_n[i][0], b_n[j][0])
        end = min(a_n[i][1], b_n[j][1])
        if start < end:
            out.append((start, end))
        if a_n[i][1] < b_n[j][1]:
            i += 1
        else:
            j += 1
    return out


def contains(intervals: Sequence[Interval], candidate: Interval) -> bool:
    """True if one interval of the normalized `intervals` covers `candidate` entirely."""
    starts = [s for s, _ in intervals]
    idx = bisect_left(starts, candidate[0])
    # The covering interval starts at or before the candidate.
    for k in (idx, idx - 1):
        if 0 <= k < len(intervals) and intervals[k][0] <= candidate[0] and candidate[1] <= intervals[k][1]:
            return True
    return False


def overlaps_any(intervals: Sequence[Interval], candidate: Interval) -> bool:
    """True if `candidate` overlaps any of the normalized `intervals`."""
    starts = [s for s, _ in intervals]
    idx = bisect_left(starts, candidate[1])
    # Only intervals starting before the candidate ends can overlap; the latest such one ends last
    # among those that could (they're merged), so checking it is enough.
    return idx > 0 and intervals[idx - 1][1] > candidate[0]


def local_to_utc(day: date, minutes: int, tz: ZoneInfo) -> datetime:
    """Wall-clock `minutes` after midnight on `day` in `tz`, as UTC. 1440 means the next midnight.

    Nonexistent local times (spring-forward gap) resolve forward, ambiguous ones (fall-back) to the
    first occurrence, which is how a person reading a clock would expect their shift to start.
    """
    if minutes >= 1440:
        day, minutes = day + timedelta(days=1), minutes - 1440
    local = datetime.combine(day, time(minutes // 60, minutes % 60), tzinfo=tz)
    utc = local.astimezone(UTC)
    # A wall time inside a DST gap doesn't round-trip; zoneinfo shifts it, which is what we want.
    return utc


def expand_weekly(
    rows: Iterable[tuple[int, int, int]], tz: ZoneInfo, first_day: date, last_day: date
) -> list[Interval]:
    """Weekly (weekday, start_min, end_min) rows → UTC intervals for every local day in [first, last]."""
    by_weekday: dict[int, list[tuple[int, int]]] = {}
    for weekday, start_min, end_min in rows:
        by_weekday.setdefault(weekday, []).append((start_min, end_min))
    out: list[Interval] = []
    day = first_day
    while day <= last_day:
        for start_min, end_min in by_weekday.get(day.weekday(), []):
            out.append((local_to_utc(day, start_min, tz), local_to_utc(day, end_min, tz)))
        day += timedelta(days=1)
    return normalize(out)
