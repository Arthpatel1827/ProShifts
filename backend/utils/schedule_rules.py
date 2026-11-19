# utils/schedule_rules.py
"""
One set of rules for "can this person work this shift?", shared by assignment, moving a
shift (drag & drop / manual edit) and shift swaps.

Checks run against the *resulting* schedule: callers pass the shifts the person is about
to give up (`ignore_shift_ids`), so a swap or a move is judged on what the schedule will
look like afterwards, not on what it looks like now.

Outcome levels:
  errors       hard conflicts — never applied: not active at the location (also covers
               another company's users), overlapping shifts, approved time off.
  availability outside the person's availability — managers may override, as they can
               when assigning (code OUTSIDE_AVAILABILITY).
  warnings     shown, not blocking: overtime, over the person's max weekly hours,
               role mismatch, no availability on file is NOT a warning (treated as free).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from extensions import db
from utils import timezones as tzu
from utils.availability import availability_conflict


@dataclass
class Placement:
    user_id: int
    name: str | None = None
    errors: list[dict] = field(default_factory=list)
    availability: str | None = None
    warnings: list[dict] = field(default_factory=list)
    week_hours_after: float | None = None

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "name": self.name,
            "ok": self.ok,
            "errors": self.errors,
            "availability": self.availability,
            "warnings": self.warnings,
            "week_hours_after": None if self.week_hours_after is None else round(self.week_hours_after, 2),
        }


def paid_hours(start, end, break_minutes) -> float:
    return max((end - start).total_seconds() / 60 - (break_minutes or 0), 0) / 60


def overlapping_shift(user_id, start, end, ignore_shift_ids=()):
    """The person's first draft/published shift overlapping [start, end), ignoring the
    shifts they are giving up in this change."""
    from models import Shift, ShiftAssignment
    q = (
        db.session.query(Shift)
        .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
        .filter(
            ShiftAssignment.user_id == user_id,
            Shift.status.in_(["draft", "published"]),
            Shift.start_time < end,
            Shift.end_time > start,
        )
    )
    ignore = [i for i in ignore_shift_ids if i is not None]
    if ignore:
        q = q.filter(Shift.shift_id.notin_(ignore))
    return q.order_by(Shift.start_time.asc()).first()


def approved_time_off_on(user_id, days) -> bool:
    from models import TimeOffRequest
    lo, hi = min(days), max(days)
    reqs = TimeOffRequest.query.filter(
        TimeOffRequest.user_id == user_id,
        TimeOffRequest.status == "approved",
        TimeOffRequest.start_date <= hi,
        TimeOffRequest.end_date >= lo,
    ).all()
    return any(r.start_date <= d <= r.end_date for r in reqs for d in days)


def week_paid_hours(user_id, tz, monday, ignore_shift_ids=()) -> float:
    from models import Shift, ShiftAssignment
    ws, we = tzu.week_bounds(tz, monday)
    q = (
        db.session.query(Shift)
        .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
        .filter(ShiftAssignment.user_id == user_id,
                Shift.status.in_(["draft", "published"]),
                Shift.start_time >= ws, Shift.start_time < we)
    )
    ignore = [i for i in ignore_shift_ids if i is not None]
    if ignore:
        q = q.filter(Shift.shift_id.notin_(ignore))
    return sum(paid_hours(s.start_time, s.end_time, s.break_minutes) for s in q.all())


def _fmt_shift(shift, tz) -> str:
    s, e = tzu.to_local(shift.start_time, tz), tzu.to_local(shift.end_time, tz)
    return f"{s.strftime('%a %b %d')} {s.strftime('%I:%M %p').lstrip('0')}–{e.strftime('%I:%M %p').lstrip('0')}"


def check_placement(*, user_id, location_id, start, end, break_minutes=0, role_id=None,
                    ignore_shift_ids=(), extra_hours=0.0, extra_spans=()) -> Placement:
    """Would `user_id` working [start, end) at `location_id` be allowed?

    ignore_shift_ids: shifts this person gives up in the same change (swap / move).
    extra_spans:      other shifts they gain in the same change, [(start, end)], so a
                      change that adds two shifts is checked against both.
    extra_hours:      paid hours they gain elsewhere in the same change (same week).
    """
    from flask import current_app
    from models import Employment, Role

    start, end = tzu.as_aware_utc(start), tzu.as_aware_utc(end)
    tz = tzu.location_tz_by_id(location_id)
    p = Placement(user_id=user_id)

    emp = Employment.query.filter_by(user_id=user_id, location_id=location_id, status="active").first()
    if not emp:
        # Same message for unknown users and other companies' users: nothing leaks.
        p.errors.append({"code": "NOT_ACTIVE", "message": "User is not an active employee at this location"})
        return p
    p.name = (emp.user.display_name or emp.user.username) if emp.user else None
    who = p.name or "This employee"

    clash = overlapping_shift(user_id, start, end, ignore_shift_ids)
    if clash is not None:
        p.errors.append({
            "code": "OVERLAP",
            "message": f"{who} already has a shift that overlaps this time ({_fmt_shift(clash, tz)})",
            "shift_id": clash.shift_id,
        })
    for (s2, e2) in extra_spans:
        if s2 < end and e2 > start:
            p.errors.append({"code": "OVERLAP", "message": f"{who} would have two overlapping shifts after this change"})
            break

    s_loc, e_loc = tzu.to_local(start, tz), tzu.to_local(end, tz)
    days = {s_loc.date(), (e_loc - timedelta(minutes=1)).date()}
    if approved_time_off_on(user_id, days):
        p.errors.append({"code": "TIME_OFF", "message": f"{who} has approved time off on this day"})

    p.availability = availability_conflict(user_id, location_id, start, end)

    # Leaders can cover any role; anyone else on a shift for a different role is flagged.
    if role_id is not None and emp.role_id != role_id:
        role = Role.query.get(role_id)
        leader = bool(emp.role and emp.role.name.lower() in ("owner", "manager", "supervisor"))
        if role and not leader:
            p.warnings.append({
                "code": "ROLE_MISMATCH",
                "message": f"{who}'s role is {emp.role.name if emp.role else 'unset'}, this shift is for {role.name}",
            })

    monday = tzu.week_monday(s_loc.date())
    total = week_paid_hours(user_id, tz, monday, ignore_shift_ids) + extra_hours + paid_hours(start, end, break_minutes)
    p.week_hours_after = total
    threshold = float(current_app.config.get("OVERTIME_WEEKLY_HOURS") or 40)
    if emp.max_hours_week and total > emp.max_hours_week:
        p.warnings.append({"code": "MAX_HOURS",
                           "message": f"{who} would be at {total:.1f} h this week (their max is {emp.max_hours_week} h)"})
    if total > threshold:
        if emp.overtime_eligible:
            p.warnings.append({"code": "OVERTIME",
                               "message": f"Overtime: {who} would reach {total:.1f} h this week (threshold {threshold:g} h)"})
        else:
            p.warnings.append({"code": "OVERTIME_NOT_ELIGIBLE",
                               "message": f"{who} would reach {total:.1f} h this week, over the {threshold:g} h overtime threshold, and isn't overtime-eligible"})
    return p
