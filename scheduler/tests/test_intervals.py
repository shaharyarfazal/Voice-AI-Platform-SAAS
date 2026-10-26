from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.core.intervals import contains, expand_weekly, intersect, local_to_utc, normalize, overlaps_any, subtract

NY = ZoneInfo("America/New_York")


def t(h: int, m: int = 0) -> datetime:
    return datetime(2026, 6, 1, h, m, tzinfo=UTC)


def test_normalize_merges_overlapping_and_touching():
    assert normalize([(t(9), t(10)), (t(10), t(11)), (t(13), t(14)), (t(9, 30), t(9, 45)), (t(15), t(15))]) == [
        (t(9), t(11)),
        (t(13), t(14)),
    ]


def test_subtract_splits_and_trims():
    assert subtract([(t(8), t(17))], [(t(10), t(11)), (t(16), t(18)), (t(7), t(8, 30))]) == [
        (t(8, 30), t(10)),
        (t(11), t(16)),
    ]
    assert subtract([(t(8), t(9))], [(t(7), t(10))]) == []


def test_intersect():
    assert intersect([(t(8), t(12)), (t(13), t(17))], [(t(11), t(14))]) == [(t(11), t(12)), (t(13), t(14))]


def test_overlaps_and_contains_are_half_open():
    busy = normalize([(t(10), t(11)), (t(13), t(14))])
    assert not overlaps_any(busy, (t(11), t(12)))  # starts as the other ends
    assert not overlaps_any(busy, (t(9), t(10)))  # ends as the other starts
    assert overlaps_any(busy, (t(10, 59), t(11, 30)))
    assert overlaps_any(busy, (t(9), t(15)))  # covers both
    assert contains(busy, (t(10), t(11)))
    assert not contains(busy, (t(10, 30), t(13, 30)))


def test_expand_weekly_follows_dst_spring_forward():
    # 8 March 2026: New York springs forward at 02:00. An 08:00–17:00 shift is 13:00Z–22:00Z the
    # day before (EST) and 12:00Z–21:00Z that day (EDT).
    rows = [(5, 8 * 60, 17 * 60), (6, 8 * 60, 17 * 60)]  # Saturday, Sunday
    out = expand_weekly(rows, NY, date(2026, 3, 7), date(2026, 3, 8))
    assert out == [
        (datetime(2026, 3, 7, 13, tzinfo=UTC), datetime(2026, 3, 7, 22, tzinfo=UTC)),
        (datetime(2026, 3, 8, 12, tzinfo=UTC), datetime(2026, 3, 8, 21, tzinfo=UTC)),
    ]


def test_expand_weekly_follows_dst_fall_back_and_overnight_end():
    # 1 November 2026: back to EST. A shift ending at 24:00 ends at the next local midnight.
    out = expand_weekly([(6, 20 * 60, 1440)], NY, date(2026, 11, 1), date(2026, 11, 1))
    assert out == [(datetime(2026, 11, 2, 1, tzinfo=UTC), datetime(2026, 11, 2, 5, tzinfo=UTC))]


def test_nonexistent_local_time_resolves_forward():
    # 02:30 doesn't exist on 8 March 2026 in New York; it becomes 03:30 EDT (07:30Z).
    assert local_to_utc(date(2026, 3, 8), 150, NY) == datetime(2026, 3, 8, 7, 30, tzinfo=UTC)
