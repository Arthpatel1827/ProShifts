# utils/availability.py
"""
Availability checks shared by manual assignment, bulk add, copy & paste and the
AI Schedule Copilot, so every way of putting someone on a shift applies the same rule.

Availability is recurring local wall-clock windows per weekday (models.Availability).
Someone with no availability on file is treated as available: there is nothing to check.
"""
from datetime import datetime, time, timedelta

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def availability_gaps(windows_by_day: dict, start_local: datetime, end_local: datetime) -> list[str]:
    """Days/times of [start_local, end_local) not covered by an availability window.
    An overnight shift must be covered on both days (until midnight, then from midnight)."""
    gaps = []
    cur = start_local
    while cur < end_local:
        next_midnight = datetime.combine(cur.date() + timedelta(days=1), time.min, tzinfo=cur.tzinfo)
        seg_end = min(end_local, next_midnight)
        seg_start_t = cur.time()
        reaches_midnight = seg_end == next_midnight
        seg_end_t = time(23, 59) if reaches_midnight else seg_end.time()
        day = DAYS[cur.weekday()]
        covered = any(
            w_start <= seg_start_t and (w_end >= seg_end_t)
            for (w_start, w_end) in windows_by_day.get(day, [])
        )
        if not covered:
            gaps.append(f"{day.title()} {seg_start_t.strftime('%H:%M')}–{'24:00' if reaches_midnight else seg_end_t.strftime('%H:%M')}")
        cur = seg_end
    return gaps


def availability_conflict(user_id, location_id, start, end) -> str | None:
    """A readable reason if this shift falls outside the person's availability, else None."""
    from models import Availability, Employment
    from utils import timezones as tzu

    emp = Employment.query.filter_by(user_id=user_id, location_id=location_id, status="active").first()
    if not emp:
        return None
    windows = {}
    for av in Availability.query.filter_by(emp_id=emp.emp_id).all():
        windows.setdefault(av.day_of_week, []).append((av.start_time, av.end_time))
    if not windows:
        return None
    tz = tzu.location_tz_by_id(location_id)
    gaps = availability_gaps(windows, tzu.to_local(start, tz), tzu.to_local(end, tz))
    if not gaps:
        return None
    name = (emp.user.display_name or emp.user.username) if emp.user else "This employee"
    return f"Outside {name}'s availability ({', '.join(gaps)})"
