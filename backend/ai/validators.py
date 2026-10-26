# ai/validators.py
"""
Deterministic checks for AI schedule recommendations. Nothing here asks the model.

Reused from ShiftService (the same rules manual scheduling enforces):
  - overlap with the employee's other draft/published shifts  (_has_overlap)
  - approved time off on the shift's local date(s)             (_approved_timeoff_map)
  - active employment at the shift's location                  (as assign_user)

Added for AI recommendations (manual scheduling leaves these to the manager's judgement,
so they had no shared implementation to reuse):
  - availability windows, role match, weekly max hours, overtime, shift length,
    not in the past, and no overlaps inside the proposal itself.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from flask import current_app

from ai.schemas import ScheduleRecommendation, parse_hhmm
from extensions import db
from models import Availability, Employment, Location, Role, Shift, ShiftAssignment
from services.shift_service import ShiftService
from utils import timezones as tzu
from utils.availability import availability_gaps  # shared with manual/bulk/copy assignment

MIN_SHIFT_HOURS = 1
MAX_SHIFT_HOURS = 16
# Same fallback ShiftService.get_labor_cost uses for employees without a rate.
DEFAULT_RATE = 15.0

_shifts = ShiftService()


def overtime_threshold() -> float:
    """Weekly hours after which overtime applies. Jurisdictions differ (e.g. 40 vs 44),
    so it is configuration (OVERTIME_WEEKLY_HOURS), not a constant in code."""
    return float(current_app.config.get("OVERTIME_WEEKLY_HOURS") or 40)


@dataclass
class Result:
    index: int
    rec: ScheduleRecommendation
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    start: datetime | None = None
    end: datetime | None = None
    paid_hours: float = 0.0
    cost: float = 0.0
    employee_name: str | None = None
    role_name: str | None = None
    week_hours_after: float | None = None

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_dict(self, tz) -> dict:
        r = self.rec
        return {
            "index": self.index,
            "valid": self.ok,
            "user_id": r.user_id,
            "employee_name": self.employee_name,
            "date": r.date.isoformat(),
            "start_time": r.start_time,
            "end_time": r.end_time,
            "overnight": bool(self.start and self.end and tzu.local_date_of(self.end, tz) != tzu.local_date_of(self.start, tz)),
            "role_id": r.role_id,
            "role_name": self.role_name,
            "existing_shift_id": r.existing_shift_id,
            "break_minutes": r.break_minutes,
            "reason": r.reason,
            "paid_hours": round(self.paid_hours, 2),
            "estimated_cost": round(self.cost, 2),
            "week_hours_after": None if self.week_hours_after is None else round(self.week_hours_after, 2),
            "failures": self.failures,
            "warnings": self.warnings,
        }


class ScheduleValidator:
    """Validates recommendations for ONE location. The caller has already verified the
    manager's access to that location; every ID in a recommendation is checked here."""

    def __init__(self, location: Location):
        self.location = location
        self.tz = tzu.location_tz(location)
        self.now = tzu.utc_now()
        self.threshold = overtime_threshold()
        self.emps = {
            e.user_id: e
            for e in Employment.query.filter_by(location_id=location.loc_id, status="active").all()
        }
        self.roles = {r.role_id: r for r in Role.query.filter_by(location_id=location.loc_id).all()}
        self._windows = {}
        self._week_hours = {}
        # Accepted so far in this batch: user_id -> [(start, end)], (user_id, monday) -> hours
        self._batch_spans = {}
        self._batch_hours = {}

    # ── helpers ──────────────────────────────────────────────────────────────
    def name(self, user_id):
        emp = self.emps.get(user_id)
        u = emp.user if emp else None
        return (u.display_name or u.username) if u else None

    def windows(self, emp: Employment) -> dict:
        if emp.emp_id not in self._windows:
            by_day = {}
            for av in Availability.query.filter_by(emp_id=emp.emp_id).all():
                by_day.setdefault(av.day_of_week, []).append((av.start_time, av.end_time))
            self._windows[emp.emp_id] = by_day
        return self._windows[emp.emp_id]

    def scheduled_hours(self, user_id, monday) -> float:
        """Paid hours already on the schedule (draft + published) in that local week."""
        key = (user_id, monday)
        if key not in self._week_hours:
            ws, we = tzu.week_bounds(self.tz, monday)
            rows = (
                db.session.query(Shift)
                .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
                .filter(ShiftAssignment.user_id == user_id,
                        Shift.status.in_(["draft", "published"]),
                        Shift.start_time >= ws, Shift.start_time < we)
                .all()
            )
            self._week_hours[key] = sum(paid_hours(s.start_time, s.end_time, s.break_minutes) for s in rows)
        return self._week_hours[key]

    def resolve_times(self, rec: ScheduleRecommendation):
        start_local = datetime.combine(rec.date, parse_hhmm(rec.start_time), tzinfo=self.tz)
        end_day = rec.date if parse_hhmm(rec.end_time) > parse_hhmm(rec.start_time) else rec.date + timedelta(days=1)
        end_local = datetime.combine(end_day, parse_hhmm(rec.end_time), tzinfo=self.tz)
        return tzu.as_aware_utc(start_local), tzu.as_aware_utc(end_local)

    # ── the checks ───────────────────────────────────────────────────────────
    def check(self, rec: ScheduleRecommendation, index: int = 0, week_monday=None) -> Result:
        res = Result(index=index, rec=rec)
        fail, warn = res.failures.append, res.warnings.append

        # Existing open shift: its times and role are authoritative, not the model's.
        if rec.existing_shift_id is not None:
            shift = Shift.query.get(rec.existing_shift_id)
            if not shift or shift.location_id != self.location.loc_id:
                fail(f"Shift #{rec.existing_shift_id} doesn't exist at this location.")
                return res
            if shift.status == "cancelled":
                fail("That shift is cancelled.")
                return res
            if ShiftAssignment.query.filter_by(shift_id=shift.shift_id, user_id=rec.user_id).first():
                fail("This employee is already assigned to that shift.")
                return res
            s_loc, e_loc = tzu.to_local(shift.start_time, self.tz), tzu.to_local(shift.end_time, self.tz)
            rec.date, rec.start_time, rec.end_time = s_loc.date(), s_loc.strftime("%H:%M"), e_loc.strftime("%H:%M")
            rec.role_id, rec.break_minutes = shift.role_id, shift.break_minutes or 0
            res.start, res.end = tzu.as_aware_utc(shift.start_time), tzu.as_aware_utc(shift.end_time)
        else:
            res.start, res.end = self.resolve_times(rec)

        start, end = res.start, res.end
        start_local, end_local = tzu.to_local(start, self.tz), tzu.to_local(end, self.tz)

        # Employee: must hold an active employment at THIS location. Other companies'
        # users get the same message as unknown IDs, so nothing leaks across tenants.
        emp = self.emps.get(rec.user_id)
        if not emp:
            same_company = Employment.query.filter_by(user_id=rec.user_id, comp_id=self.location.comp_id).all()
            if not same_company:
                fail(f"Employee #{rec.user_id} isn't an active employee at this location.")
            elif any(e.status == "active" for e in same_company):
                fail("This employee works at a different location.")
            else:
                fail("This employee's employment isn't active.")
            return res
        if emp.comp_id != self.location.comp_id:  # defensive; location_id implies company
            fail("This employee isn't part of this company.")
            return res
        res.employee_name = self.name(rec.user_id)

        # Role
        if rec.role_id is not None:
            role = self.roles.get(rec.role_id)
            if not role:
                fail(f"Role #{rec.role_id} isn't defined at this location.")
            else:
                res.role_name = role.name
                if emp.role_id != rec.role_id:
                    fail(f"{res.employee_name}'s role is {emp.role.name if emp.role else 'unset'}, not {role.name}.")

        # Length and timing
        hours = (end - start).total_seconds() / 3600
        if hours < MIN_SHIFT_HOURS or hours > MAX_SHIFT_HOURS:
            fail(f"Shift length {hours:.1f} h is outside the allowed {MIN_SHIFT_HOURS}–{MAX_SHIFT_HOURS} h.")
        if rec.break_minutes >= hours * 60:
            fail("Break is as long as the shift.")
        if start <= self.now:
            fail("This shift starts in the past.")
        if week_monday is not None:
            if not (week_monday <= start_local.date() < week_monday + timedelta(days=7)):
                fail(f"Date {start_local.date().isoformat()} is outside the requested week.")

        # Availability (local wall-clock windows per weekday)
        windows = self.windows(emp)
        if not windows:
            warn(f"{res.employee_name} has no availability on file — confirm with them.")
        else:
            gaps = availability_gaps(windows, start_local, end_local)
            if gaps:
                fail(f"Outside {res.employee_name}'s availability ({', '.join(gaps)}).")

        # Approved time off — same lookup assign_user uses, on every local date touched.
        days = {start_local.date(), (end_local - timedelta(minutes=1)).date()}
        time_off = _shifts._approved_timeoff_map(self.location.loc_id, min(days), max(days) + timedelta(days=1))
        if any(_shifts._is_on_timeoff(time_off, rec.user_id, d) for d in days):
            fail(f"{res.employee_name} has approved time off that day.")

        # Overlap with saved shifts (ShiftService rule) and with this proposal.
        if ShiftService._has_overlap(rec.user_id, start, end):
            fail(f"{res.employee_name} already has a shift that overlaps this time.")
        for (s, e) in self._batch_spans.get(rec.user_id, []):
            if s < end and e > start:
                fail(f"Overlaps another recommended shift for {res.employee_name}.")
                break

        # Weekly hours
        res.paid_hours = paid_hours(start, end, rec.break_minutes)
        monday = tzu.week_monday(start_local.date())
        total = self.scheduled_hours(rec.user_id, monday) + self._batch_hours.get((rec.user_id, monday), 0) + res.paid_hours
        res.week_hours_after = total
        if emp.max_hours_week and total > emp.max_hours_week:
            fail(f"Would put {res.employee_name} at {total:.1f} h this week (max {emp.max_hours_week} h).")
        elif total > self.threshold:
            if not emp.overtime_eligible:
                fail(f"Would put {res.employee_name} at {total:.1f} h, over the {self.threshold:g} h overtime threshold, and they aren't overtime-eligible.")
            else:
                warn(f"Overtime: {res.employee_name} would reach {total:.1f} h this week (threshold {self.threshold:g} h).")

        rate = float(emp.hourly_rate) if emp.hourly_rate is not None else DEFAULT_RATE
        if emp.hourly_rate is None:
            warn(f"No hourly rate on file for {res.employee_name}; cost estimated at ${DEFAULT_RATE:.0f}/h.")
        res.cost = res.paid_hours * rate

        if res.ok:
            self._batch_spans.setdefault(rec.user_id, []).append((start, end))
            self._batch_hours[(rec.user_id, monday)] = self._batch_hours.get((rec.user_id, monday), 0) + res.paid_hours
        return res

    def validate_all(self, recs, week_monday=None) -> list[Result]:
        return [self.check(r, i, week_monday) for i, r in enumerate(recs)]


def paid_hours(start, end, break_minutes) -> float:
    return max((end - start).total_seconds() / 60 - (break_minutes or 0), 0) / 60
