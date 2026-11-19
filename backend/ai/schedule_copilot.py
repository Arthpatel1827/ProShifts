# ai/schedule_copilot.py
"""
AI Schedule Copilot.

generate(): Nemotron proposes shifts as structured data → every item is validated
            deterministically → the manager gets valid recommendations, rejected ones with
            reasons, and metrics computed by the backend (not by the model). Nothing is saved.
apply():    the manager's accepted items are validated AGAIN (the client is never trusted),
            then created as DRAFT shifts through ShiftService.create_shift / assign_user —
            the same code manual scheduling uses. Publishing stays the existing flow.
"""
import json
import logging
from datetime import datetime, timedelta

from pydantic import ValidationError

from ai.client import AIBadResponse, NemotronClient
from ai.schemas import DAYS, ApplyRequest, GenerateRequest, ScheduleProposal, parse_hhmm
from ai.tools import AIContext
from ai.validators import DEFAULT_RATE, ScheduleValidator, overtime_threshold, paid_hours
from extensions import db
from models import Availability, Role, Shift, TimeOffRequest
from services.shift_service import ShiftService
from utils import timezones as tzu

log = logging.getLogger("proshifts.ai")
_shifts = ShiftService()

RULES_CHECKED = [
    "Employee exists and is active", "Employee belongs to this company and location", "Employee holds the shift's role",
    "Within the employee's availability", "No approved time off", "No overlapping shifts (saved or recommended)",
    "Weekly max hours", "Overtime threshold", "Shift length 1–16 h", "Starts in the future and inside the week",
]

PROPOSE_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_schedule",
        "description": "Submit the recommended draft shifts for the week.",
        "parameters": {
            "type": "object",
            "properties": {
                "shifts": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "user_id": {"type": "integer"},
                        "date": {"type": "string", "description": "YYYY-MM-DD, the local date the shift starts"},
                        "start_time": {"type": "string", "description": "HH:MM 24-hour local"},
                        "end_time": {"type": "string", "description": "HH:MM; at or before start_time = ends next day"},
                        "role_id": {"type": ["integer", "null"]},
                        "existing_shift_id": {"type": ["integer", "null"], "description": "Set to fill an open shift instead of creating one"},
                        "break_minutes": {"type": "integer"},
                        "reason": {"type": "string", "description": "One short sentence"},
                    },
                    "required": ["user_id", "date", "start_time", "end_time", "reason"],
                }},
                "summary": {"type": "string", "description": "2–3 sentences on the approach and any trade-offs"},
            },
            "required": ["shifts", "summary"],
        },
    },
}


def _context(ctx: AIContext, monday, req: GenerateRequest) -> dict:
    tz = ctx.tz
    ws, we = tzu.week_bounds(tz, monday)
    week_days = [monday + timedelta(days=i) for i in range(7)]
    shifts = ctx.week_shifts(monday)
    hours = {}
    for s in shifts:
        for a in s.assignments:
            hours[a.user_id] = hours.get(a.user_id, 0) + paid_hours(s.start_time, s.end_time, s.break_minutes)
    staff_ids = list(ctx.staff().keys())
    time_off = TimeOffRequest.query.filter(
        TimeOffRequest.comp_id == ctx.location.comp_id, TimeOffRequest.user_id.in_(staff_ids or [0]),
        TimeOffRequest.status == "approved",
        TimeOffRequest.start_date <= week_days[-1], TimeOffRequest.end_date >= week_days[0],
    ).all()
    off = {}
    for r in time_off:
        off.setdefault(r.user_id, []).extend(d.isoformat() for d in week_days if r.start_date <= d <= r.end_date)

    staff = []
    for uid, e in ctx.staff().items():
        av = Availability.query.filter_by(emp_id=e.emp_id).all()
        staff.append({
            "user_id": uid, "name": ctx.name(uid), "role_id": e.role_id, "role": e.role.name if e.role else None,
            "hourly_rate": float(e.hourly_rate) if e.hourly_rate is not None else None,
            "max_hours_week": e.max_hours_week, "overtime_eligible": e.overtime_eligible,
            "already_scheduled_hours": round(hours.get(uid, 0), 2),
            "availability": [{"day": a.day_of_week, "start": a.start_time.strftime("%H:%M"), "end": a.end_time.strftime("%H:%M")}
                             for a in sorted(av, key=lambda a: (DAYS.index(a.day_of_week), a.start_time))] or "not on file",
            "approved_time_off_dates": sorted(set(off.get(uid, []))),
        })
    cost = _shifts.get_labor_cost(location_id=ctx.location_id, week_start=monday.isoformat())
    return {
        "location": ctx.location.loc_name, "timezone": tz.key,
        "week": [f"{d.isoformat()} ({d.strftime('%a')})" for d in week_days],
        "today": ctx.today().isoformat(),
        "roles": [{"role_id": r.role_id, "name": r.name} for r in Role.query.filter_by(location_id=ctx.location_id).all()],
        "staff": staff,
        "existing_shifts": [ctx.fmt_shift(s) for s in shifts],
        "staffing_requirements": [r.model_dump() for r in req.requirements] or "none given — fill open shifts and keep coverage similar to existing shifts",
        "labor_budget": req.labor_budget,
        "current_projected_labor_cost": cost["total_cost"],
        "overtime_threshold_hours": overtime_threshold(),
        "manager_instructions": req.instructions or None,
    }


def _prompt(data: dict) -> str:
    return f"""Recommend DRAFT shifts for the week below. A manager will review every shift; ProShifts validates each one and rejects any that break a rule.

Rules:
- Use only user_id and role_id values from the data. Never invent IDs.
- Only dates in "week", starting after "today". Times are local wall-clock HH:MM.
- Stay inside each person's availability windows; skip their approved_time_off_dates.
- No overlaps with existing_shifts they are assigned to, or with each other.
- Respect max_hours_week (counting already_scheduled_hours); avoid exceeding overtime_threshold_hours.
- A shift's role_id must equal the person's role_id.
- Prefer filling open existing shifts (nobody assigned) by setting existing_shift_id.
- Meet staffing_requirements headcount when given. Keep projected cost within labor_budget when given; prefer lower rates when equally suitable. Spread hours fairly.
- If nothing fits, return an empty list and say why in the summary.

Data:
{json.dumps(data, default=str)}

Call propose_schedule exactly once."""


def _parse(result) -> ScheduleProposal:
    raw = None
    for call in result.tool_calls:
        if call.name == "propose_schedule":
            raw = call.arguments
            break
    if raw is None and result.content:
        text = result.content.strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text[4:] if text.lower().startswith("json") else text
        try:
            raw = json.loads(text[text.find("{"): text.rfind("}") + 1])
        except (ValueError, TypeError):
            raw = None
    if not isinstance(raw, dict) or raw.get("__invalid_json__"):
        raise AIBadResponse("The AI didn't return a structured schedule.")
    try:
        return ScheduleProposal.model_validate(raw)
    except ValidationError as e:
        log.warning("ai.schedule malformed proposal errors=%d", len(e.errors()))
        raise AIBadResponse("The AI returned a schedule in the wrong format. Try again.")


def _coverage(ctx, monday, requirements, results, existing_shifts):
    """Backend-computed coverage of the requirements (or of open shifts if none given)."""
    tz = ctx.tz
    accepted = [r for r in results if r.ok]
    if requirements:
        needed = covered = 0
        spans = []  # (start, end, role_id) for saved assignments + accepted recommendations
        for s in existing_shifts:
            for _ in s.assignments:
                spans.append((tzu.as_aware_utc(s.start_time), tzu.as_aware_utc(s.end_time), s.role_id))
        for r in accepted:
            spans.append((r.start, r.end, r.rec.role_id if r.rec.role_id is not None else ctx.staff()[r.rec.user_id].role_id))
        for req in requirements:
            for i in range(7):
                d = monday + timedelta(days=i)
                if DAYS[d.weekday()] not in req.days:
                    continue
                s_local = tzu.localize(datetime.combine(d, parse_hhmm(req.start_time)), tz)
                e_day = d if parse_hhmm(req.end_time) > parse_hhmm(req.start_time) else d + timedelta(days=1)
                e_local = tzu.localize(datetime.combine(e_day, parse_hhmm(req.end_time)), tz)
                s_utc, e_utc = tzu.as_aware_utc(s_local), tzu.as_aware_utc(e_local)
                have = sum(1 for (a, b, role) in spans if a <= s_utc and b >= e_utc and (req.role_id is None or role == req.role_id))
                needed += req.headcount
                covered += min(have, req.headcount)
        return {"basis": "staffing requirements", "covered": covered, "required": needed,
                "pct": round(covered / needed * 100, 1) if needed else None}
    open_ids = {s.shift_id for s in existing_shifts if not s.assignments}
    if open_ids:
        filled = {r.rec.existing_shift_id for r in accepted if r.rec.existing_shift_id in open_ids}
        return {"basis": "open shifts", "covered": len(filled), "required": len(open_ids),
                "pct": round(len(filled) / len(open_ids) * 100, 1)}
    return {"basis": "none", "covered": None, "required": None, "pct": None}


def generate(ctx: AIContext, req: GenerateRequest, client: NemotronClient | None = None) -> dict:
    client = client or NemotronClient()
    monday = tzu.week_monday(req.week_start)
    if monday + timedelta(days=7) <= ctx.today():
        raise ValueError("That week is already over. Pick the current or a future week.")

    data = _context(ctx, monday, req)
    result = client.chat(
        [{"role": "system", "content": "You are a careful workforce scheduler for ProShifts. You only output structured recommendations."},
         {"role": "user", "content": _prompt(data)}],
        feature="schedule_copilot", tools=[PROPOSE_TOOL],
        tool_choice={"type": "function", "function": {"name": "propose_schedule"}},
        max_tokens=4000, temperature=0.4,
    )
    proposal = _parse(result)

    validator = ScheduleValidator(ctx.location)
    results = validator.validate_all(proposal.shifts, week_monday=monday)
    existing = ctx.week_shifts(monday)
    current = _shifts.get_labor_cost(location_id=ctx.location_id, week_start=monday.isoformat())

    # Projected cost = today's projection + each accepted recommendation. Filling an open
    # shift replaces its placeholder cost (DEFAULT_RATE) with the person's real rate.
    delta, filled = 0.0, set()
    open_ids = {s.shift_id for s in existing if not s.assignments}
    for r in results:
        if not r.ok:
            continue
        sid = r.rec.existing_shift_id
        if sid in open_ids and sid not in filled:
            filled.add(sid)
            delta += r.cost - r.paid_hours * DEFAULT_RATE
        else:
            delta += r.cost
    projected = round(current["total_cost"] + delta, 2)
    valid = [r for r in results if r.ok]
    overtime_people = {r.rec.user_id for r in valid if any(w.startswith("Overtime") for w in r.warnings)}
    log.info("ai.schedule feature=schedule_copilot proposed=%d valid=%d rejected=%d", len(results), len(valid), len(results) - len(valid))

    return {
        "week_start": monday.isoformat(),
        "timezone": ctx.tz.key,
        "summary": proposal.summary,
        "recommendations": [r.to_dict(ctx.tz) for r in results],
        "metrics": {
            "proposed": len(results),
            "valid": len(valid),
            "rejected": len(results) - len(valid),
            "coverage": _coverage(ctx, monday, req.requirements, results, existing),
            "current_labor_cost": current["total_cost"],
            "projected_labor_cost": projected,
            "added_hours": round(sum(r.paid_hours for r in valid), 2),
            "labor_budget": req.labor_budget,
            "budget_variance": None if req.labor_budget is None else round(projected - req.labor_budget, 2),
            "overtime_employees": len(overtime_people),
        },
        "rules_checked": RULES_CHECKED,
        "model": client.model,
    }


def apply(ctx: AIContext, req: ApplyRequest) -> tuple[dict, int]:
    validator = ScheduleValidator(ctx.location)
    results = validator.validate_all(req.shifts)
    if not all(r.ok for r in results):
        return {"applied": False, "error": "Some shifts no longer pass validation. Nothing was saved.",
                "results": [r.to_dict(ctx.tz) for r in results]}, 422

    created, assigned, failed = [], [], []
    for r in results:
        rec = r.rec
        new_shift = None
        try:
            if rec.existing_shift_id is not None:
                shift_id = rec.existing_shift_id
            else:
                note = f"AI recommendation: {rec.reason}".strip()[:300] if rec.reason else "AI recommendation"
                new_shift = _shifts.create_shift(
                    caller_user_id=ctx.caller_user_id, location_id=ctx.location_id,
                    start_time=r.start, end_time=r.end, role_id=rec.role_id,
                    break_minutes=rec.break_minutes, notes=note, created_by_ai=True,
                )
                shift_id = new_shift.shift_id
            _shifts.assign_user(shift_id=shift_id, user_id=rec.user_id, caller_user_id=ctx.caller_user_id)
            (created if new_shift else assigned).append(shift_id)
        except (ValueError, PermissionError) as e:
            db.session.rollback()
            if new_shift is not None:  # don't leave an empty AI draft behind
                db.session.delete(Shift.query.get(new_shift.shift_id))
                db.session.commit()
            failed.append({"index": r.index, "error": str(e)})
    log.info("ai.schedule_apply created=%d assigned=%d failed=%d", len(created), len(assigned), len(failed))
    return {"applied": True, "created_shift_ids": created, "assigned_existing_shift_ids": assigned,
            "failed": failed, "status": "draft",
            "message": "Saved as draft shifts. Review them on the schedule and publish when ready."}, 200
