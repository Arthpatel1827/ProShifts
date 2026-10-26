# ai/tools.py
"""
Read-only tools the model can call. Each one queries THIS location's real data.

Tenant isolation is structural: an AIContext is only built after the caller is verified
as a manager at `location_id`, every query filters by that location, and any ID the model
passes in (user_id, shift_id, role_id) is checked against the location before use. An
unknown or foreign ID gets an error result, never another tenant's data.

Results go back to the model, so they carry only what scheduling needs: names, roles,
hours, rates, availability, dates. No emails, phone numbers, addresses or credentials.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta

from ai.schemas import DAYS, ScheduleRecommendation
from ai.validators import DEFAULT_RATE, ScheduleValidator, availability_gaps, overtime_threshold, paid_hours
from models import Availability, Employment, Location, Shift, TimeOffRequest
from services.shift_service import ShiftService
from utils import timezones as tzu

_shifts = ShiftService()
NEAR_OVERTIME_MARGIN = 4  # hours below the threshold that count as "approaching"


class ToolError(Exception):
    pass


@dataclass
class AIContext:
    location: Location
    caller_user_id: int

    @property
    def location_id(self):
        return self.location.loc_id

    @property
    def tz(self):
        return tzu.location_tz(self.location)

    def today(self):
        return tzu.local_today(self.tz)

    def staff(self) -> dict:
        if not hasattr(self, "_staff"):
            self._staff = {
                e.user_id: e
                for e in Employment.query.filter_by(location_id=self.location_id, status="active").all()
                if e.user
            }
        return self._staff

    def name(self, user_id):
        e = self.staff().get(user_id)
        return (e.user.display_name or e.user.username) if e else None

    def employee(self, user_id) -> Employment:
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            raise ToolError("user_id must be an integer from a previous tool result.")
        emp = self.staff().get(uid)
        if not emp:
            raise ToolError(f"No active employee with user_id {uid} at this location. Use list_staff for valid IDs.")
        return emp

    def shift(self, shift_id) -> Shift:
        try:
            sid = int(shift_id)
        except (TypeError, ValueError):
            raise ToolError("shift_id must be an integer from a previous tool result.")
        s = Shift.query.get(sid)
        if not s or s.location_id != self.location_id:
            raise ToolError(f"No shift {sid} at this location. Use get_week_schedule for valid IDs.")
        return s

    def week(self, week_start=None):
        """Monday of the local week containing week_start (default: this week)."""
        day = tzu.parse_date(week_start) if week_start else None
        if week_start and not day:
            raise ToolError("Dates must be YYYY-MM-DD.")
        return tzu.week_monday(day or self.today())

    def week_shifts(self, monday, statuses=("draft", "published")):
        ws, we = tzu.week_bounds(self.tz, monday)
        return (
            Shift.query.filter(
                Shift.location_id == self.location_id,
                Shift.status.in_(list(statuses)),
                Shift.start_time >= ws, Shift.start_time < we,
            ).order_by(Shift.start_time.asc()).all()
        )

    def fmt_shift(self, s: Shift) -> dict:
        st, en = tzu.to_local(s.start_time, self.tz), tzu.to_local(s.end_time, self.tz)
        return {
            "shift_id": s.shift_id,
            "date": st.date().isoformat(),
            "weekday": st.strftime("%A"),
            "start": st.strftime("%H:%M"),
            "end": en.strftime("%H:%M"),
            "overnight": en.date() != st.date(),
            "paid_hours": round(paid_hours(s.start_time, s.end_time, s.break_minutes), 2),
            "role_id": s.role_id,
            "role": s.role.name if s.role else None,
            "status": s.status,
            "assigned": [{"user_id": a.user_id, "name": self.name(a.user_id) or "Former employee"} for a in s.assignments],
        }


# ── Tool implementations ──────────────────────────────────────────────────────

def list_staff(ctx: AIContext):
    out = []
    for uid, e in sorted(ctx.staff().items(), key=lambda kv: ctx.name(kv[0]) or ""):
        out.append({
            "user_id": uid,
            "name": ctx.name(uid),
            "role_id": e.role_id,
            "role": e.role.name if e.role else None,
            "employment_type": e.employment_type,
            "hourly_rate": float(e.hourly_rate) if e.hourly_rate is not None else None,
            "max_hours_week": e.max_hours_week,
            "overtime_eligible": e.overtime_eligible,
        })
    return {"location": ctx.location.loc_name, "staff": out}


def get_week_schedule(ctx: AIContext, week_start=None):
    monday = ctx.week(week_start)
    shifts = ctx.week_shifts(monday)
    days = []
    for i in range(7):
        d = monday + timedelta(days=i)
        day_shifts = [ctx.fmt_shift(s) for s in shifts if tzu.local_date_of(s.start_time, ctx.tz) == d]
        people = {a["user_id"] for s in day_shifts for a in s["assigned"]}
        days.append({
            "date": d.isoformat(), "weekday": d.strftime("%A"),
            "shifts": day_shifts,
            "people_working": len(people),
            "scheduled_hours": round(sum(s["paid_hours"] * max(len(s["assigned"]), 1) for s in day_shifts), 2),
            "unassigned_shifts": sum(1 for s in day_shifts if not s["assigned"]),
        })
    return {
        "week_start": monday.isoformat(), "week_end": (monday + timedelta(days=6)).isoformat(),
        "timezone": ctx.tz.key, "days": days,
        "draft_shifts": sum(1 for s in shifts if s.status == "draft"),
        "published_shifts": sum(1 for s in shifts if s.status == "published"),
    }


def get_employee_availability(ctx: AIContext, user_id=None):
    emps = [ctx.employee(user_id)] if user_id is not None else list(ctx.staff().values())
    out = []
    for e in emps:
        rows = Availability.query.filter_by(emp_id=e.emp_id).all()
        rows.sort(key=lambda a: (DAYS.index(a.day_of_week), a.start_time))
        out.append({
            "user_id": e.user_id, "name": ctx.name(e.user_id),
            "availability_on_file": bool(rows),
            "windows": [{"day": a.day_of_week, "start": a.start_time.strftime("%H:%M"), "end": a.end_time.strftime("%H:%M")} for a in rows],
        })
    return {"timezone": ctx.tz.key, "employees": out}


def _rec(user_id, date_s, start_s, end_s, role_id=None, existing_shift_id=None):
    try:
        return ScheduleRecommendation(user_id=user_id, date=date_s, start_time=start_s, end_time=end_s,
                                      role_id=role_id, existing_shift_id=existing_shift_id)
    except Exception:
        raise ToolError("Use date YYYY-MM-DD and times HH:MM (24-hour).")


def find_available_staff(ctx: AIContext, date, start_time, end_time, role_id=None):
    if role_id is not None:
        try:
            role_id = int(role_id)
        except (TypeError, ValueError):
            raise ToolError("role_id must be an integer.")
    _rec(0, date, start_time, end_time)  # shape check
    v = ScheduleValidator(ctx.location)
    available, unavailable = [], []
    for uid in ctx.staff():
        r = v.check(_rec(uid, date, start_time, end_time, role_id))
        item = {"user_id": uid, "name": r.employee_name or ctx.name(uid), "week_hours_if_scheduled": round(r.week_hours_after or 0, 1)}
        if r.ok:
            available.append({**item, "notes": r.warnings})
        else:
            unavailable.append({**item, "reasons": r.failures})
    available.sort(key=lambda x: x["week_hours_if_scheduled"])
    return {"date": date, "start": start_time, "end": end_time, "timezone": ctx.tz.key,
            "available": available, "unavailable": unavailable,
            "rules_checked": ["availability", "approved time off", "overlapping shifts", "role", "weekly max hours", "overtime"]}


def find_shift_replacements(ctx: AIContext, shift_id):
    shift = ctx.shift(shift_id)
    if shift.status == "cancelled":
        raise ToolError("That shift is cancelled.")
    info = ctx.fmt_shift(shift)
    assigned = {a.user_id for a in shift.assignments}
    v = ScheduleValidator(ctx.location)
    candidates, excluded = [], []
    for uid in ctx.staff():
        if uid in assigned:
            continue
        r = v.check(_rec(uid, info["date"], info["start"], info["end"], existing_shift_id=shift.shift_id))
        item = {"user_id": uid, "name": r.employee_name or ctx.name(uid), "week_hours_if_assigned": round(r.week_hours_after or 0, 1)}
        (candidates if r.ok else excluded).append({**item, **({"notes": r.warnings} if r.ok else {"reasons": r.failures})})
    candidates.sort(key=lambda x: x["week_hours_if_assigned"])
    return {"shift": info, "candidates": candidates, "not_eligible": excluded}


def _availability_hours(windows) -> float:
    total = 0.0
    for w_start, w_end in windows:
        a = w_start.hour * 60 + w_start.minute
        b = w_end.hour * 60 + w_end.minute
        total += max(b - a, 0) / 60
    return total


def get_employee_hours(ctx: AIContext, week_start=None):
    monday = ctx.week(week_start)
    threshold = overtime_threshold()
    hours, counts = defaultdict(float), defaultdict(int)
    for s in ctx.week_shifts(monday):
        for a in s.assignments:
            hours[a.user_id] += paid_hours(s.start_time, s.end_time, s.break_minutes)
            counts[a.user_id] += 1
    out = []
    for uid, e in ctx.staff().items():
        rows = Availability.query.filter_by(emp_id=e.emp_id).all()
        avail = _availability_hours([(a.start_time, a.end_time) for a in rows]) if rows else None
        h = hours.get(uid, 0.0)
        status = "ok"
        if e.max_hours_week and h > e.max_hours_week:
            status = "over_max_hours"
        elif h > threshold:
            status = "overtime"
        elif h >= threshold - NEAR_OVERTIME_MARGIN:
            status = "approaching_overtime"
        out.append({
            "user_id": uid, "name": ctx.name(uid), "role": e.role.name if e.role else None,
            "scheduled_hours": round(h, 2), "shifts": counts.get(uid, 0),
            "max_hours_week": e.max_hours_week,
            "weekly_availability_hours": None if avail is None else round(avail, 2),
            "unused_availability_hours": None if avail is None else round(max(avail - h, 0), 2),
            "status": status,
        })
    out.sort(key=lambda x: x["scheduled_hours"])
    return {"week_start": monday.isoformat(), "overtime_threshold_hours": threshold, "employees": out}


def get_overtime_risk(ctx: AIContext, week_start=None):
    data = get_employee_hours(ctx, week_start)
    risky = [e for e in data["employees"] if e["status"] != "ok"]
    return {"week_start": data["week_start"], "overtime_threshold_hours": data["overtime_threshold_hours"],
            "near_margin_hours": NEAR_OVERTIME_MARGIN, "at_risk": sorted(risky, key=lambda x: -x["scheduled_hours"])}


def get_open_shifts(ctx: AIContext, week_start=None):
    monday = ctx.week(week_start)
    open_ = [ctx.fmt_shift(s) for s in ctx.week_shifts(monday) if not s.assignments]
    return {"week_start": monday.isoformat(), "open_shifts": open_,
            "note": "ProShifts has no per-shift headcount requirement, so 'understaffed' means a shift with nobody assigned."}


def get_labor_cost(ctx: AIContext, week_start=None):
    monday = ctx.week(week_start)
    base = _shifts.get_labor_cost(location_id=ctx.location_id, week_start=monday.isoformat())
    prev = _shifts.get_labor_cost(location_id=ctx.location_id, week_start=(monday - timedelta(days=7)).isoformat())
    threshold = overtime_threshold()
    by_day, by_emp = defaultdict(lambda: [0.0, 0.0]), defaultdict(lambda: [0.0, 0.0])
    staff = ctx.staff()
    for s in ctx.week_shifts(monday):
        h = paid_hours(s.start_time, s.end_time, s.break_minutes)
        day = tzu.local_date_of(s.start_time, ctx.tz).isoformat()
        people = [a.user_id for a in s.assignments] or [None]
        for uid in people:
            e = staff.get(uid)
            rate = float(e.hourly_rate) if e is not None and e.hourly_rate is not None else DEFAULT_RATE
            by_day[day][0] += h
            by_day[day][1] += h * rate
            if uid is not None:
                by_emp[uid][0] += h
                by_emp[uid][1] += h * rate
    return {
        "week_start": monday.isoformat(),
        "total_cost": base["total_cost"], "total_hours": base["total_hours"], "total_shifts": base["total_shifts"],
        "unassigned_hours": base["unassigned_hours"],
        "previous_week_cost": prev["total_cost"], "previous_week_hours": prev["total_hours"],
        "by_day": [{"date": d, "hours": round(v[0], 2), "cost": round(v[1], 2)} for d, v in sorted(by_day.items())],
        "by_employee": sorted(
            [{"user_id": u, "name": ctx.name(u), "hours": round(v[0], 2), "cost": round(v[1], 2),
              "overtime_hours": round(max(v[0] - threshold, 0), 2)} for u, v in by_emp.items()],
            key=lambda x: -x["cost"]),
        "method": f"Draft + published shifts × each employee's hourly rate; unassigned shifts and missing rates use ${DEFAULT_RATE:.0f}/h.",
    }


def get_time_off(ctx: AIContext, days_ahead=30):
    try:
        days_ahead = max(1, min(int(days_ahead), 120))
    except (TypeError, ValueError):
        days_ahead = 30
    today = ctx.today()
    ids = list(ctx.staff().keys())
    if not ids:
        return {"requests": []}
    reqs = TimeOffRequest.query.filter(
        TimeOffRequest.comp_id == ctx.location.comp_id,
        TimeOffRequest.user_id.in_(ids),
        TimeOffRequest.status.in_(["pending", "approved"]),
        TimeOffRequest.end_date >= today,
        TimeOffRequest.start_date <= today + timedelta(days=days_ahead),
    ).order_by(TimeOffRequest.start_date.asc()).all()
    return {"from": today.isoformat(), "to": (today + timedelta(days=days_ahead)).isoformat(), "requests": [
        {"request_id": r.request_id, "user_id": r.user_id, "name": ctx.name(r.user_id), "status": r.status,
         "type": r.request_type, "start_date": r.start_date.isoformat(), "end_date": r.end_date.isoformat()}
        for r in reqs]}


def get_schedule_conflicts(ctx: AIContext, week_start=None):
    """Rule problems with assignments already on the week's schedule."""
    monday = ctx.week(week_start)
    shifts = ctx.week_shifts(monday)
    threshold = overtime_threshold()
    staff = ctx.staff()
    conflicts = []
    by_user = defaultdict(list)
    for s in shifts:
        for a in s.assignments:
            by_user[a.user_id].append(s)
    first, last = monday, monday + timedelta(days=8)
    time_off = _shifts._approved_timeoff_map(ctx.location_id, first, last)
    for uid, lst in by_user.items():
        e = staff.get(uid)
        name = ctx.name(uid) or "Former employee"
        lst.sort(key=lambda s: s.start_time)
        for a, b in zip(lst, lst[1:]):
            if b.start_time < a.end_time:
                conflicts.append({"type": "overlap", "user_id": uid, "name": name, "shift_ids": [a.shift_id, b.shift_id],
                                  "detail": f"{name} is double-booked on {ctx.fmt_shift(b)['date']}."})
        if not e:
            conflicts.append({"type": "inactive_employee", "user_id": uid, "name": name, "shift_ids": [s.shift_id for s in lst],
                              "detail": "Assigned but no longer an active employee here."})
            continue
        windows = defaultdict(list)
        for av in Availability.query.filter_by(emp_id=e.emp_id).all():
            windows[av.day_of_week].append((av.start_time, av.end_time))
        total = 0.0
        for s in lst:
            st, en = tzu.to_local(s.start_time, ctx.tz), tzu.to_local(s.end_time, ctx.tz)
            total += paid_hours(s.start_time, s.end_time, s.break_minutes)
            if _shifts._is_on_timeoff(time_off, uid, st.date()):
                conflicts.append({"type": "time_off", "user_id": uid, "name": name, "shift_ids": [s.shift_id],
                                  "detail": f"{name} has approved time off on {st.date().isoformat()}."})
            if windows:
                gaps = availability_gaps(windows, st, en)
                if gaps:
                    conflicts.append({"type": "outside_availability", "user_id": uid, "name": name, "shift_ids": [s.shift_id],
                                      "detail": f"Outside availability: {', '.join(gaps)}."})
            if s.role_id and e.role_id != s.role_id:
                conflicts.append({"type": "role_mismatch", "user_id": uid, "name": name, "shift_ids": [s.shift_id],
                                  "detail": f"Shift needs {s.role.name if s.role else 'another role'}; {name} is {e.role.name if e.role else 'unassigned'}."})
        if e.max_hours_week and total > e.max_hours_week:
            conflicts.append({"type": "over_max_hours", "user_id": uid, "name": name, "shift_ids": [s.shift_id for s in lst],
                              "detail": f"{total:.1f} h scheduled; max is {e.max_hours_week} h."})
        elif total > threshold:
            conflicts.append({"type": "overtime", "user_id": uid, "name": name, "shift_ids": [s.shift_id for s in lst],
                              "detail": f"{total:.1f} h scheduled, over the {threshold:g} h overtime threshold."})
    return {"week_start": monday.isoformat(), "conflicts": conflicts}


# ── Registry (OpenAI tool format) ─────────────────────────────────────────────

_WEEK = {"week_start": {"type": "string", "description": "Any date (YYYY-MM-DD) in the week; defaults to the current week."}}

TOOLS = {
    "list_staff": (list_staff, "Active employees at this location with user_id, role, hourly rate, weekly max hours and overtime eligibility.", {}, []),
    "get_week_schedule": (get_week_schedule, "Shifts for a Monday–Sunday week: times, roles, status, who is assigned, headcount per day.", _WEEK, []),
    "get_employee_availability": (get_employee_availability, "Recurring weekly availability windows (location time). Omit user_id for everyone.",
                                  {"user_id": {"type": "integer"}}, []),
    "find_available_staff": (find_available_staff,
                             "Who could work a given date and time. Checks availability, approved time off, overlapping shifts, role, weekly max hours and overtime. An end time at or before the start means overnight.",
                             {"date": {"type": "string", "description": "YYYY-MM-DD"},
                              "start_time": {"type": "string", "description": "HH:MM 24-hour, location time"},
                              "end_time": {"type": "string", "description": "HH:MM 24-hour, location time"},
                              "role_id": {"type": "integer", "description": "Optional role the person must hold"}},
                             ["date", "start_time", "end_time"]),
    "find_shift_replacements": (find_shift_replacements, "Eligible people to cover an existing shift (by shift_id), fewest weekly hours first, plus who is ineligible and why.",
                                {"shift_id": {"type": "integer"}}, ["shift_id"]),
    "get_employee_hours": (get_employee_hours, "Scheduled hours per employee for a week vs weekly max, overtime threshold and availability (who is under- or over-scheduled).", _WEEK, []),
    "get_overtime_risk": (get_overtime_risk, "Employees over or approaching the overtime threshold or their weekly max for a week.", _WEEK, []),
    "get_open_shifts": (get_open_shifts, "Shifts with nobody assigned (understaffed) in a week.", _WEEK, []),
    "get_labor_cost": (get_labor_cost, "Projected labor cost for a week, by day and by employee, with the previous week for comparison.", _WEEK, []),
    "get_time_off": (get_time_off, "Pending and approved time-off requests for this location's staff in the coming days.",
                     {"days_ahead": {"type": "integer", "description": "Default 30"}}, []),
    "get_schedule_conflicts": (get_schedule_conflicts, "Rule problems in a week's schedule: double-booking, time off, outside availability, role mismatch, over max hours, overtime.", _WEEK, []),
}


def tool_specs() -> list[dict]:
    return [
        {"type": "function", "function": {
            "name": name, "description": desc,
            "parameters": {"type": "object", "properties": props, "required": req, "additionalProperties": False},
        }}
        for name, (_, desc, props, req) in TOOLS.items()
    ]


def run_tool(ctx: AIContext, name: str, args: dict) -> dict:
    entry = TOOLS.get(name)
    if not entry:
        return {"error": f"Unknown tool {name!r}."}
    fn, _, props, required = entry
    if args.get("__invalid_json__"):
        return {"error": "Tool arguments were not valid JSON."}
    clean = {k: v for k, v in args.items() if k in props}
    missing = [k for k in required if clean.get(k) in (None, "")]
    if missing:
        return {"error": f"Missing argument(s): {', '.join(missing)}."}
    try:
        return fn(ctx, **clean)
    except ToolError as e:
        return {"error": str(e)}
