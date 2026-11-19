# ai/insights.py
"""
Weekly labor & staffing insights.

facts() is deterministic: every number comes from the database (via ai.tools). It works
with AI switched off, so the dashboard card never depends on Nemotron.
recommend() asks Nemotron for suggestions grounded in those facts. The model only adds
RECOMMENDATIONS; it never supplies facts or figures that are shown as facts.
"""
import json
import logging
from collections import defaultdict
from datetime import timedelta

from pydantic import ValidationError

from ai import tools as T
from ai.client import AIBadResponse, NemotronClient
from ai.schemas import InsightNarrative
from ai.validators import DEFAULT_RATE, paid_hours
from models import Shift
from utils import timezones as tzu

log = logging.getLogger("proshifts.ai")

HISTORY_WEEKS = 8
OVER_HISTORY = 1.25   # a day this far above its 8-week average is flagged
UNDER_HISTORY = 0.75


def _history(ctx: T.AIContext, monday):
    """Average published paid hours per weekday over the previous HISTORY_WEEKS weeks."""
    start, _ = tzu.week_bounds(ctx.tz, monday - timedelta(weeks=HISTORY_WEEKS))
    end, _ = tzu.week_bounds(ctx.tz, monday)
    rows = Shift.query.filter(
        Shift.location_id == ctx.location_id, Shift.status == "published",
        Shift.start_time >= start, Shift.start_time < end,
    ).all()
    per_day = defaultdict(float)  # (week_monday, weekday) -> hours
    weeks = set()
    for s in rows:
        d = tzu.local_date_of(s.start_time, ctx.tz)
        weeks.add(tzu.week_monday(d))
        per_day[d.weekday()] += paid_hours(s.start_time, s.end_time, s.break_minutes) * max(len(s.assignments), 1)
    n = len(weeks)
    return ({wd: per_day[wd] / n for wd in range(7)} if n else {}), n


def facts(ctx: T.AIContext, week_start=None, budget: float | None = None) -> dict:
    monday = ctx.week(week_start)
    labor = T.get_labor_cost(ctx, monday.isoformat())
    hours = T.get_employee_hours(ctx, monday.isoformat())
    open_ = T.get_open_shifts(ctx, monday.isoformat())["open_shifts"]
    conflicts = T.get_schedule_conflicts(ctx, monday.isoformat())["conflicts"]
    history, history_weeks = _history(ctx, monday)

    by_day = {d["date"]: d for d in labor["by_day"]}
    days = []
    for i in range(7):
        d = monday + timedelta(days=i)
        cur = by_day.get(d.isoformat(), {"hours": 0.0, "cost": 0.0})
        avg = history.get(d.weekday()) if history_weeks else None
        days.append({"date": d.isoformat(), "weekday": d.strftime("%A"), "hours": cur["hours"], "cost": cur["cost"],
                     "history_avg_hours": None if avg is None else round(avg, 2)})

    overtime = [e for e in hours["employees"] if e["status"] in ("overtime", "over_max_hours")]
    approaching = [e for e in hours["employees"] if e["status"] == "approaching_overtime"]
    underused = sorted([e for e in hours["employees"] if (e["unused_availability_hours"] or 0) >= 4],
                       key=lambda e: -e["unused_availability_hours"])

    issues = []
    if open_:
        issues.append({"type": "open_shifts", "severity": "high",
                       "text": f"{len(open_)} shift{'s' if len(open_) != 1 else ''} with nobody assigned"})
    if overtime:
        issues.append({"type": "overtime", "severity": "high",
                       "text": f"{len(overtime)} employee{'s' if len(overtime) != 1 else ''} over the overtime threshold or their weekly max"})
    if approaching:
        issues.append({"type": "approaching_overtime", "severity": "medium",
                       "text": f"{len(approaching)} employee{'s' if len(approaching) != 1 else ''} approaching overtime"})
    if conflicts:
        issues.append({"type": "conflicts", "severity": "high",
                       "text": f"{len(conflicts)} schedule conflict{'s' if len(conflicts) != 1 else ''}"})
    variance = None
    if budget:
        variance = round(labor["total_cost"] - budget, 2)
        if variance > 0:
            issues.append({"type": "over_budget", "severity": "high",
                           "text": f"Projected labor {variance / budget * 100:.1f}% above budget"})
    elif labor["previous_week_cost"] and labor["total_cost"] > labor["previous_week_cost"] * 1.10:
        change = (labor["total_cost"] / labor["previous_week_cost"] - 1) * 100
        issues.append({"type": "cost_increase", "severity": "medium",
                       "text": f"Projected labor {change:.0f}% higher than last week"})

    # Savings we can actually calculate: hours scheduled above a weekday's 8-week average,
    # priced at that day's own average cost per hour. Shown as an upper bound, not a promise.
    savings = []
    for d in days:
        avg = d["history_avg_hours"]
        if avg and d["hours"] > avg * OVER_HISTORY:
            extra = d["hours"] - avg
            per_hour = d["cost"] / d["hours"] if d["hours"] else DEFAULT_RATE
            savings.append({"date": d["date"], "weekday": d["weekday"], "hours_above_average": round(extra, 2),
                            "cost_of_those_hours": round(extra * per_hour, 2)})
            issues.append({"type": "above_history", "severity": "low",
                           "text": f"{d['weekday']} is {d['hours'] - avg:.1f} h above its {history_weeks}-week average"})
        elif avg and d["hours"] < avg * UNDER_HISTORY:
            issues.append({"type": "below_history", "severity": "low",
                           "text": f"{d['weekday']} is {avg - d['hours']:.1f} h below its {history_weeks}-week average"})

    return {
        "week_start": monday.isoformat(), "timezone": ctx.tz.key,
        "labor": {"projected_cost": labor["total_cost"], "scheduled_hours": labor["total_hours"],
                  "previous_week_cost": labor["previous_week_cost"], "budget": budget, "variance": variance,
                  "method": labor["method"]},
        "issues": issues,
        "open_shifts": open_,
        "overtime": overtime, "approaching_overtime": approaching,
        "underused_availability": underused[:10],
        "conflicts": conflicts,
        "days": days, "history_weeks": history_weeks,
        "savings_opportunities": savings,
        "overtime_threshold_hours": hours["overtime_threshold_hours"],
    }


RECOMMEND_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_recommendations",
        "description": "Submit 2–5 short, actionable scheduling recommendations.",
        "parameters": {"type": "object", "properties": {
            "recommendations": {"type": "array", "items": {"type": "string"}}}, "required": ["recommendations"]},
    },
}


def recommend(ctx: T.AIContext, data: dict, client: NemotronClient | None = None) -> dict:
    client = client or NemotronClient()
    prompt = f"""These are verified facts about the schedule for the week of {data['week_start']} at "{ctx.location.loc_name}" (timezone {data['timezone']}).
Suggest 2–5 concrete actions a manager could take. Rules:
- Base every suggestion on the facts; refer to people and days by name.
- Do not state new numbers as facts. Any savings must cite "savings_opportunities" and be phrased as "up to".
- Phrase each item as a suggestion ("Consider …"). No preamble.

Facts:
{json.dumps(data, default=str)}

Call submit_recommendations once."""
    result = client.chat([{"role": "user", "content": prompt}], feature="insights", tools=[RECOMMEND_TOOL],
                         tool_choice={"type": "function", "function": {"name": "submit_recommendations"}},
                         max_tokens=800, temperature=0.4)
    raw = next((c.arguments for c in result.tool_calls if c.name == "submit_recommendations"), None)
    if raw is None and result.content:
        try:
            text = result.content
            raw = json.loads(text[text.find("{"): text.rfind("}") + 1])
        except (ValueError, TypeError):
            raw = None
    try:
        narrative = InsightNarrative.model_validate(raw or {})
    except ValidationError:
        raise AIBadResponse("The AI returned recommendations in the wrong format.")
    if not narrative.recommendations:
        raise AIBadResponse("The AI didn't return any recommendations.")
    return {"recommendations": narrative.recommendations, "model": client.model}
