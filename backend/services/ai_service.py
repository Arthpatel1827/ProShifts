# services/ai_service.py
"""
Older AI endpoints, now on the Nemotron layer in ai/.

The free-text chat and schedule generator that wrote model output straight into the
database were replaced by ai.assistant (read-only) and ai.schedule_copilot (validated
drafts that a manager applies).
"""
import json
from datetime import timedelta

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ai.client import AIBadResponse, NemotronClient
from ai.tools import AIContext, ToolError, find_shift_replacements
from models import Location, Shift, ShiftSwap
from utils import timezones as tzu

_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class _DayPrediction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    recommended_staff: int = Field(ge=0, le=500)
    confidence: str = "medium"
    reason: str = ""


class _Prediction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    predictions: dict[str, _DayPrediction]
    summary: str = ""
    warnings: list[str] = Field(default_factory=list)


class AIService:

    # ── Staffing predictor ────────────────────────────────────────────────────
    def predict_staffing(self, *, location_id, target_week, client: NemotronClient | None = None):
        tz = tzu.location_tz_by_id(location_id)
        historical = Shift.query.filter(
            Shift.location_id == location_id,
            Shift.status == "published",
            Shift.start_time >= tzu.utc_now() - timedelta(weeks=8),
        ).all()

        day_counts = {d: [] for d in _WEEKDAYS}
        for shift in historical:
            day_counts[tzu.to_local(shift.start_time, tz).strftime("%A")].append(len(shift.assignments))
        history_summary = {
            day: {"avg_staff": round(sum(c) / len(c), 1) if c else 0, "max_staff": max(c) if c else 0, "data_points": len(c)}
            for day, c in day_counts.items()
        }

        prompt = f"""You are a staffing analyst. Predict how many staff are needed each day for the week starting {target_week}.
Base it only on this history of the last 8 weeks (assignments per published shift, by weekday):
{json.dumps(history_summary)}
If there is little or no history, say so in "warnings" and keep confidence low.
Respond ONLY with JSON: {{"predictions": {{"Monday": {{"recommended_staff": 0, "confidence": "low|medium|high", "reason": "..."}}, ... all 7 days}}, "summary": "...", "warnings": []}}"""

        client = client or NemotronClient()
        result = client.chat([{"role": "user", "content": prompt}], feature="staffing_prediction", max_tokens=1000, temperature=0.3)
        text = result.content
        try:
            parsed = _Prediction.model_validate(json.loads(text[text.find("{"): text.rfind("}") + 1]))
        except (ValueError, TypeError, ValidationError):
            raise AIBadResponse("The AI returned a forecast ProShifts couldn't read.")
        out = parsed.model_dump()
        out.update(target_week=target_week, location_id=location_id, history_summary=history_summary, model=client.model)
        return out

    # ── Swap recommendations ──────────────────────────────────────────────────
    def recommend_swap_matches(self, *, swap_id, location_id, caller_user_id):
        """Deterministic: eligible coworkers for the swapped shift (availability, time off,
        overlaps, role, hours all checked), fewest weekly hours first."""
        swap = ShiftSwap.query.get(swap_id)
        shift = Shift.query.get(swap.shift_id) if swap else None
        if not shift or shift.location_id != location_id:
            raise LookupError("Swap request not found at this location")
        ctx = AIContext(location=Location.query.get(location_id), caller_user_id=caller_user_id)
        try:
            data = find_shift_replacements(ctx, shift.shift_id)
        except ToolError as e:
            raise LookupError(str(e))
        return [
            {"user_id": c["user_id"], "name": c["name"],
             "reason": f"Eligible; {c['week_hours_if_assigned']:g} h that week if they take it."}
            for c in data["candidates"] if c["user_id"] != swap.requesting_user_id
        ][:3]
