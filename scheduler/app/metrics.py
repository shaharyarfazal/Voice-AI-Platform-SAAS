from prometheus_client import Counter, Histogram

AVAILABILITY_SECONDS = Histogram(
    "sched_availability_seconds", "Time to compute availability", buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 3)
)
HOLDS = Counter("sched_holds_total", "Hold attempts by result", ["result"])
# Each one is a double booking the exclusion constraint prevented.
OVERLAPS_BLOCKED = Counter("sched_overlaps_blocked_total", "Inserts/updates rejected by the no-overlap constraint")
BOOKINGS = Counter("sched_bookings_total", "Booking state changes", ["action", "source"])
LIVE_CHECK_FALLBACK = Counter("sched_live_check_fallback_total", "Live calendar checks answered from the cache (provider unavailable)")
SYNC_SECONDS = Histogram("sched_calendar_sync_seconds", "Time to sync one external calendar", buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 30))
PUSH = Counter("sched_calendar_push_total", "Calendar writes by result", ["result"])
WEBHOOKS = Counter("sched_webhooks_total", "Calendar change notifications", ["provider", "result"])
