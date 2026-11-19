# ai/schemas.py
"""
Structured shapes for what the model may return and what managers may send.

These only check *shape*. Whether a recommendation is allowed (availability, time off,
overlaps, role, hours) is decided by ai.validators against the database.
"""
import re
from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _hhmm(v: str) -> str:
    v = (v or "").strip()
    if len(v) == 8 and v.count(":") == 2:  # tolerate HH:MM:SS
        v = v[:5]
    if not _HHMM.match(v):
        raise ValueError("time must be HH:MM (24-hour)")
    return v


def parse_hhmm(v: str) -> time:
    h, m = _hhmm(v).split(":")
    return time(int(h), int(m))


class ScheduleRecommendation(BaseModel):
    """One shift the model proposes. Times are wall-clock at the location; an end time
    at or before the start time means the shift ends the next day (overnight)."""
    model_config = ConfigDict(extra="ignore")

    user_id: int
    date: date
    start_time: str
    end_time: str
    role_id: int | None = None
    # Fill an existing unassigned shift instead of creating a new one.
    existing_shift_id: int | None = None
    break_minutes: int = Field(default=0, ge=0, le=240)
    reason: str = ""

    @field_validator("start_time", "end_time")
    @classmethod
    def _times(cls, v):
        return _hhmm(v)

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, v):
        return str(v or "")[:400]


class ScheduleProposal(BaseModel):
    model_config = ConfigDict(extra="ignore")

    shifts: list[ScheduleRecommendation] = Field(default_factory=list, max_length=200)
    summary: str = ""

    @field_validator("summary", mode="before")
    @classmethod
    def _summary(cls, v):
        return str(v or "")[:1500]


class StaffingRequirement(BaseModel):
    """Manager input: `headcount` people with an optional role, on `days`, from start to end."""
    model_config = ConfigDict(extra="forbid")

    days: list[str] = Field(default_factory=lambda: list(DAYS), min_length=1)
    start_time: str
    end_time: str
    role_id: int | None = None
    headcount: int = Field(default=1, ge=1, le=50)

    @field_validator("start_time", "end_time")
    @classmethod
    def _times(cls, v):
        return _hhmm(v)

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        out = []
        for d in v:
            d = (d or "").strip().lower()[:3]
            if d not in DAYS:
                raise ValueError(f"days must be from {', '.join(DAYS)}")
            if d not in out:
                out.append(d)
        return out


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: int
    week_start: date
    labor_budget: float | None = Field(default=None, gt=0, le=10_000_000)
    requirements: list[StaffingRequirement] = Field(default_factory=list, max_length=40)
    instructions: str = Field(default="", max_length=1000)


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_id: int
    shifts: list[ScheduleRecommendation] = Field(min_length=1, max_length=200)


class InsightNarrative(BaseModel):
    """The model's part of an insight: suggestions only. Facts come from the backend."""
    model_config = ConfigDict(extra="ignore")

    recommendations: list[str] = Field(default_factory=list)

    @field_validator("recommendations", mode="before")
    @classmethod
    def _recs(cls, v):
        if not isinstance(v, list):
            raise ValueError("recommendations must be a list")
        return [str(x).strip()[:300] for x in v if str(x).strip()][:6]
