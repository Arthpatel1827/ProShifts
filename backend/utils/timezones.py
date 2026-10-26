# utils/timezones.py
"""Location-local calendar logic.

Storage convention (unchanged):
  • shift.start_time/end_time, time_entry.clock_in/out, break_entry.* are timestamptz
    — absolute instants.
  • created_at/updated_at/published_at/assigned_at are naive UTC (datetime.utcnow()).
  • time_off_request.start_date/end_date are plain calendar dates at the location.

Rules every caller must follow:
  • "Today", "this week" and every daily bucket are defined in the *location's*
    timezone (Location.timezone), then converted to aware UTC bounds for queries.
  • Never compare a naive datetime against a timestamptz column: PostgreSQL would read
    it in the database server's own timezone. Use the aware bounds from here.
  • A naive wall-clock time from a client ("2026-10-25T09:00:00") means that time at
    the shift's location; localize it with `localize()` before storing.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from typing import Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
DEFAULT_TZ = "UTC"


def is_valid_timezone(name: Optional[str]) -> bool:
    if not name or not isinstance(name, str):
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


@lru_cache(maxsize=256)
def get_tz(name: Optional[str]) -> ZoneInfo:
    """ZoneInfo for an IANA name, falling back to UTC for blank/unknown values."""
    try:
        return ZoneInfo(name) if name else ZoneInfo(DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def location_tz(location) -> ZoneInfo:
    return get_tz(getattr(location, "timezone", None))


def location_tz_by_id(location_id: int) -> ZoneInfo:
    from models import Location
    return location_tz(Location.query.get(location_id) if location_id else None)


def user_tz(user_id: int) -> ZoneInfo:
    """Timezone of the user's (first) active employment location; UTC if none."""
    from models import Employment
    emp = (
        Employment.query.filter_by(user_id=user_id, status="active")
        .order_by(Employment.emp_id.asc())
        .first()
    )
    return location_tz(emp.location if emp else None)


def utc_now() -> datetime:
    """Aware current instant. Wrapped so tests can freeze time in one place."""
    return datetime.now(UTC)


def local_now(tz: ZoneInfo) -> datetime:
    return utc_now().astimezone(tz)


def local_today(tz: ZoneInfo) -> date:
    return local_now(tz).date()


def day_bounds(tz: ZoneInfo, day: date) -> Tuple[datetime, datetime]:
    """[start, end) of a local calendar day as aware UTC instants.

    Built from local midnights, so DST days are correctly 23 or 25 hours long.
    """
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def week_monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_bounds(tz: ZoneInfo, any_day: date) -> Tuple[datetime, datetime]:
    """[Monday 00:00, next Monday 00:00) local, as aware UTC instants."""
    monday = week_monday(any_day)
    start, _ = day_bounds(tz, monday)
    end, _ = day_bounds(tz, monday + timedelta(days=7))
    return start, end


def month_bounds(tz: ZoneInfo, any_day: date) -> Tuple[datetime, datetime]:
    first = any_day.replace(day=1)
    nxt = first.replace(year=first.year + 1, month=1) if first.month == 12 else first.replace(month=first.month + 1)
    start, _ = day_bounds(tz, first)
    end, _ = day_bounds(tz, nxt)
    return start, end


def parse_date(value: Optional[str]) -> Optional[date]:
    """Parses 'YYYY-MM-DD' (or a longer ISO string's date part); None if invalid."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def localize(dt: datetime, tz: ZoneInfo) -> datetime:
    """Naive → that wall-clock time in `tz`; aware values are returned unchanged."""
    return dt.replace(tzinfo=tz) if dt.tzinfo is None else dt


def as_aware_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """For values read back from the DB: timestamptz is already aware; naive is UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def to_local(dt: datetime, tz: ZoneInfo) -> datetime:
    return as_aware_utc(dt).astimezone(tz)


def local_date_of(dt: datetime, tz: ZoneInfo) -> date:
    return to_local(dt, tz).date()


def format_local_time(dt: datetime, tz: ZoneInfo) -> str:
    """'9:05 AM' in the location's timezone (for user-facing messages)."""
    return to_local(dt, tz).strftime("%I:%M %p").lstrip("0")


def shift_local_str(shift, fmt: str = "%b %d at %I:%M %p") -> str:
    """Formats a shift's start in its location's timezone (notifications, channel names)."""
    return to_local(shift.start_time, location_tz(shift.location)).strftime(fmt)
