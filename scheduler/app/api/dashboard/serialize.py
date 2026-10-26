from __future__ import annotations

from typing import Any

from ...models import BusinessSettings, Service, Staff, WorkingHours
from ...verticals import get_vertical


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def settings_out(s: BusinessSettings | None, *, configured: bool = True) -> dict[str, Any]:
    vertical = get_vertical(s.vertical if s else None)
    return {
        "configured": configured,
        "vertical": vertical.key,
        "timezone": s.timezone if s else "UTC",
        "slot_granularity_min": s.slot_granularity_min if s else 30,
        "min_notice_min": s.min_notice_min if s else 120,
        "emergency_min_notice_min": s.emergency_min_notice_min if s else 30,
        "max_days_ahead": s.max_days_ahead if s else 30,
        "hold_ttl_sec": s.hold_ttl_sec if s else 180,
        "default_daily_job_cap": s.default_daily_job_cap if s else None,
        "assignment_mode": s.assignment_mode if s else "least_busy",
        "unavailable_on_reauth": s.unavailable_on_reauth if s else True,
        "service_area": (s.service_area if s else None) or {"postal_codes": []},
        "labels": {**vertical.labels, **((s.labels if s else None) or {})},
        "label_overrides": (s.labels if s else None) or {},
        "skills": list(vertical.skills),
    }


def staff_out(s: Staff, hours: list[WorkingHours] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(s.id),
        "name": s.name,
        "first_name": s.first_name,
        "phone": s.phone_e164,
        "email": s.email,
        "timezone": s.timezone,
        "skills": s.skills,
        "zones": s.zones,
        "active": s.active,
        "rr_weight": s.rr_weight,
        "priority": s.priority,
        "daily_job_cap": s.daily_job_cap,
        "color": s.color,
    }
    if hours is not None:
        out["working_hours"] = [
            {"weekday": h.weekday, "start": hhmm(h.start_min), "end": hhmm(h.end_min)}
            for h in sorted(hours, key=lambda h: (h.weekday, h.start_min))
        ]
    return out


def service_out(s: Service) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "name": s.name,
        "duration_min": s.duration_min,
        "buffer_before_min": s.buffer_before_min,
        "buffer_after_min": s.buffer_after_min,
        "required_skills": s.required_skills,
        "active": s.active,
    }
