# tests/test_ai.py
"""
AI layer tests. Only the HTTP call to NVIDIA is replaced (by FakeNvidia); the database,
tools, validators, controllers and ShiftService are all real. The scripted "model" can
only see what ProShifts' tools return, so assertions on its replies prove the data path.
"""
import copy
import json
import logging
from datetime import datetime, time, timedelta

import pytest
import requests

from tests.conftest import next_monday
from extensions import db
from models import Availability, Company, Employment, Shift, ShiftAssignment, TimeOffRequest


# ── NVIDIA stand-in (HTTP layer only) ─────────────────────────────────────────

class FakeResp:
    def __init__(self, status=200, body=None, text=None):
        self.status_code, self._body, self._text = status, body, text

    def json(self):
        if self._text is not None:
            raise ValueError("not json")
        return self._body


def tool_call(name, args, call_id="call_1"):
    return {"choices": [{"finish_reason": "tool_calls", "message": {
        "role": "assistant", "content": None,
        "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


def answer(text):
    return {"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": text}}], "usage": {}}


class FakeNvidia:
    """Each script step is a response dict, a FakeResp, an exception, or a callable that
    receives the request payload (so replies can be built from real tool results)."""

    def __init__(self, *steps):
        self.steps, self.requests = list(steps), []

    def __call__(self, session, url, headers=None, json=None, timeout=None):
        # Snapshot: the caller keeps appending to the same messages list afterwards.
        self.requests.append({"url": url, "headers": headers, "json": copy.deepcopy(json), "timeout": timeout})
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        if callable(step):
            step = step(json)
        return step if isinstance(step, FakeResp) else FakeResp(200, step)


@pytest.fixture
def ai_on(app):
    app.config.update(NVIDIA_API_KEY="nvapi-test-key-not-real", NVIDIA_NEMOTRON_MODEL="nvidia/test-nemotron",
                      NVIDIA_BASE_URL="https://nvidia.test/v1")
    yield
    app.config.update(NVIDIA_API_KEY=None, NVIDIA_NEMOTRON_MODEL="nvidia/nemotron-3-super-120b-a12b",
                      NVIDIA_BASE_URL="https://integrate.api.nvidia.com/v1")


@pytest.fixture
def nvidia(monkeypatch):
    def install(*steps):
        fake = FakeNvidia(*steps)
        monkeypatch.setattr(requests.Session, "post", lambda session, url, **kw: fake(session, url, **kw))
        return fake
    return install


def last_tool_result(payload):
    return json.loads(payload["messages"][-1]["content"])


# ── World helpers ─────────────────────────────────────────────────────────────

def set_plan(app, comp_id, plan):
    with app.app_context():
        Company.query.get(comp_id).plan = plan
        db.session.commit()


def availability(app, user_id, days=("mon", "tue", "wed", "thu", "fri", "sat", "sun"), start=time(8), end=time(23, 59)):
    with app.app_context():
        emp = Employment.query.filter_by(user_id=user_id, status="active").first()
        for d in days:
            db.session.add(Availability(emp_id=emp.emp_id, day_of_week=d, start_time=start, end_time=end))
        db.session.commit()


def employment(app, user_id, **fields):
    with app.app_context():
        emp = Employment.query.filter_by(user_id=user_id).first()
        for k, v in fields.items():
            setattr(emp, k, v)
        db.session.commit()


def time_off(app, user_id, comp_id, day, status="approved"):
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=user_id, comp_id=comp_id, start_date=day, end_date=day, status=status))
        db.session.commit()


def rec(user_id, day, start="09:00", end="17:00", **kw):
    return {"user_id": user_id, "date": day.isoformat(), "start_time": start, "end_time": end, "reason": "test", **kw}


def shift_count(app):
    with app.app_context():
        return Shift.query.count()


MON = next_monday().date()


# ── Client ────────────────────────────────────────────────────────────────────

def test_missing_key_returns_clean_error_and_scheduling_still_works(client, world, nvidia):
    fake = nvidia()  # must never be called
    res = client.post("/ai/assistant", json={"location_id": world.loc_a, "message": "Who works Monday?"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 503
    body = res.get_json()
    assert body["code"] == "AI_NOT_CONFIGURED" and "manually" in body["fallback"]
    assert fake.requests == []
    # Manual scheduling is unaffected.
    assert client.get(f"/shifts/?location_id={world.loc_a}", headers=world.headers(world.manager_a)).status_code == 200
    status = client.get(f"/ai/status?location_id={world.loc_a}", headers=world.headers(world.manager_a)).get_json()
    assert status == {"configured": False, "provider": "NVIDIA Nemotron", "model": "nvidia/nemotron-3-super-120b-a12b", "plan": "free"}


def test_successful_request_uses_env_config_and_hides_key_from_logs(app, client, world, ai_on, nvidia, caplog):
    fake = nvidia(answer("<think>internal</think>Nobody is scheduled yet."))
    caplog.set_level(logging.INFO, logger="proshifts.ai")
    res = client.post("/ai/assistant", json={"location_id": world.loc_a, "message": "Anything scheduled?"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["reply"] == "Nobody is scheduled yet."  # reasoning stripped
    req = fake.requests[0]
    assert req["url"] == "https://nvidia.test/v1/chat/completions"
    assert req["json"]["model"] == "nvidia/test-nemotron"
    assert req["headers"]["Authorization"] == "Bearer nvapi-test-key-not-real"
    assert req["json"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert {t["function"]["name"] for t in req["json"]["tools"]} >= {"find_available_staff", "get_labor_cost"}
    logs = caplog.text
    assert "feature=assistant" in logs and "outcome=ok" in logs and "latency_ms=" in logs
    assert "nvapi-test-key-not-real" not in logs and "Anything scheduled" not in logs


@pytest.mark.parametrize("step,status,code", [
    (requests.Timeout(), 504, "AI_TIMEOUT"),
    (requests.ConnectionError(), 503, "AI_UNAVAILABLE"),
    (FakeResp(500, {"error": "boom"}), 503, "AI_UNAVAILABLE"),
    (FakeResp(429, {"error": "slow down"}), 429, "AI_RATE_LIMITED"),
    (FakeResp(200, text="<html>"), 502, "AI_BAD_RESPONSE"),
    (FakeResp(200, {"choices": []}), 502, "AI_BAD_RESPONSE"),
])
def test_api_failures_map_to_clean_errors(client, world, ai_on, nvidia, step, status, code):
    nvidia(step)
    res = client.post("/ai/assistant", json={"location_id": world.loc_a, "message": "hi"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == status
    assert res.get_json()["code"] == code


# ── Assistant ─────────────────────────────────────────────────────────────────

def test_assistant_answers_from_real_data(app, client, world, ai_on, nvidia):
    availability(app, world.staff_a)
    availability(app, world.staff_a2)
    time_off(app, world.staff_a2, world.comp_a, MON)  # Ria is off Monday

    def grounded_reply(payload):
        data = last_tool_result(payload)
        return answer("Available: " + ", ".join(p["name"] for p in data["available"]))

    fake = nvidia(tool_call("find_available_staff", {"date": MON.isoformat(), "start_time": "17:00", "end_time": "22:00"}),
                  grounded_reply)
    res = client.post("/ai/assistant", json={"location_id": world.loc_a, "message": "Who can work Monday 5-10pm?"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert "Sam Staff" in body["reply"] and "Ria Barista" not in body["reply"]
    assert body["tools_used"] == [{"name": "find_available_staff", "arguments": {"date": MON.isoformat(), "start_time": "17:00", "end_time": "22:00"}, "ok": True}]
    tool_data = json.loads(fake.requests[1]["json"]["messages"][-1]["content"])
    ria = next(u for u in tool_data["unavailable"] if u["name"] == "Ria Barista")
    assert any("time off" in r for r in ria["reasons"])
    # Every ID the model saw came from the location's real staff.
    real_ids = {world.owner_a, world.manager_a, world.staff_a, world.staff_a2}
    seen = {p["user_id"] for p in tool_data["available"] + tool_data["unavailable"]}
    assert seen == real_ids


def test_assistant_requires_manager_and_auth(client, world, ai_on, nvidia):
    fake = nvidia()
    body = {"location_id": world.loc_a, "message": "hours?"}
    assert client.post("/ai/assistant", json=body).status_code == 401
    assert client.post("/ai/assistant", json=body, headers=world.headers(world.staff_a)).status_code == 403
    assert fake.requests == []


def test_assistant_tenant_isolation(app, client, world, ai_on, nvidia):
    other_shift = world.shift(world.loc_b, next_monday() + timedelta(hours=9), assign=[world.owner_b])
    # 1) Asking about another company's location is refused before any AI call.
    fake = nvidia()
    res = client.post("/ai/assistant", json={"location_id": world.loc_b, "message": "who works?"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 403 and fake.requests == []
    # 2) A foreign shift ID (as if hallucinated or injected) yields an error, not B's data.
    fake = nvidia(tool_call("find_shift_replacements", {"shift_id": other_shift}),
                  tool_call("get_employee_availability", {"user_id": world.owner_b}, call_id="call_2"),
                  answer("I couldn't find that shift."))
    res = client.post("/ai/assistant", json={"location_id": world.loc_a, "message": f"Cover shift {other_shift}"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 200
    r1 = last_tool_result(fake.requests[1]["json"])
    r2 = last_tool_result(fake.requests[2]["json"])
    assert "No shift" in r1["error"] and "No active employee" in r2["error"]
    sent = json.dumps([r["json"] for r in fake.requests])
    assert "Bea Owner" not in sent and "Bistro" not in sent and "Harbour" not in sent
    assert [t["ok"] for t in res.get_json()["tools_used"]] == [False, False]


def test_mobile_chat_never_creates_shifts(app, client, world, ai_on, nvidia):
    before = shift_count(app)
    nvidia(answer('```json\n{"action": "create_shifts", "shifts": [{"start_time": "2030-01-01T09:00:00", "end_time": "2030-01-01T17:00:00"}]}\n```'))
    res = client.post("/ai/chat", json={"location_id": world.loc_a, "message": "make shifts"},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 200
    assert res.get_json()["executed_shifts"] == [] and res.get_json()["can_write"] is False
    assert shift_count(app) == before


# ── Deterministic validation ──────────────────────────────────────────────────

def validate(app, world, recs, loc=None, week=None):
    from ai.schemas import ScheduleRecommendation
    from ai.validators import ScheduleValidator
    from models import Location
    with app.app_context():
        v = ScheduleValidator(Location.query.get(loc or world.loc_a))
        return [(r.ok, r.failures, r.warnings) for r in v.validate_all([ScheduleRecommendation(**x) for x in recs], week)]


def test_validator_available_employee_passes(app, world):
    availability(app, world.staff_a)
    [(ok, failures, warnings)] = validate(app, world, [rec(world.staff_a, MON)])
    assert ok, failures


def test_validator_outside_availability(app, world):
    availability(app, world.staff_a, start=time(12), end=time(20))
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON, "09:00", "17:00")])
    assert not ok and any("availability" in f for f in failures)


def test_validator_overnight_needs_both_days(app, world):
    availability(app, world.staff_a, days=("mon",), start=time(18), end=time(23, 59))
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON, "22:00", "02:00")])
    assert not ok and any("Tue 00:00–02:00" in f for f in failures)
    availability(app, world.staff_a, days=("tue",), start=time(0), end=time(6))
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON, "22:00", "02:00")])
    assert ok, failures


def test_validator_approved_time_off(app, world):
    availability(app, world.staff_a)
    time_off(app, world.staff_a, world.comp_a, MON)
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON)])
    assert not ok and any("time off" in f for f in failures)


def test_validator_pending_time_off_does_not_block(app, world):
    availability(app, world.staff_a)
    time_off(app, world.staff_a, world.comp_a, MON, status="pending")
    assert validate(app, world, [rec(world.staff_a, MON)])[0][0]


def test_validator_overlapping_shift(app, world):
    availability(app, world.staff_a)
    world.shift(world.loc_a, next_monday() + timedelta(hours=12), hours=4, assign=[world.staff_a])
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON, "09:00", "17:00")])
    assert not ok and any("overlaps" in f for f in failures)


def test_validator_overlap_within_proposal(app, world):
    availability(app, world.staff_a)
    results = validate(app, world, [rec(world.staff_a, MON, "09:00", "13:00"), rec(world.staff_a, MON, "12:00", "16:00")])
    assert results[0][0] and not results[1][0]
    assert any("another recommended shift" in f for f in results[1][1])


def test_validator_overtime_warns_and_limits_reject(app, world):
    availability(app, world.staff_a)
    for i in range(4):  # 4 × 10h already scheduled = 40h
        world.shift(world.loc_a, next_monday() + timedelta(days=i, hours=8), hours=10, assign=[world.staff_a])
    friday = MON + timedelta(days=4)
    [(ok, _, warnings)] = validate(app, world, [rec(world.staff_a, friday, "09:00", "13:00")])
    assert ok and any(w.startswith("Overtime") for w in warnings)

    employment(app, world.staff_a, overtime_eligible=False)
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, friday, "09:00", "13:00")])
    assert not ok and any("overtime-eligible" in f for f in failures)

    employment(app, world.staff_a, overtime_eligible=True, max_hours_week=42)
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, friday, "09:00", "13:00")])
    assert not ok and any("max 42" in f for f in failures)


def test_validator_wrong_location(app, world):
    employment(app, world.staff_a2, location_id=world.loc_a2)
    availability(app, world.staff_a2)
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a2, MON)])
    assert not ok and failures == ["This employee works at a different location."]


def test_validator_wrong_company_does_not_leak(app, world):
    [(ok, failures, _)] = validate(app, world, [rec(world.owner_b, MON)])
    unknown = validate(app, world, [rec(987654, MON)])[0][1]
    assert not ok
    assert failures == [f"Employee #{world.owner_b} isn't an active employee at this location."]
    assert unknown == ["Employee #987654 isn't an active employee at this location."]


def test_validator_inactive_employee(app, world):
    employment(app, world.staff_a, status="inactive")
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON)])
    assert not ok and failures == ["This employee's employment isn't active."]


def test_validator_role_and_shape_rules(app, world):
    availability(app, world.staff_a)
    results = validate(app, world, [
        rec(world.staff_a, MON, role_id=world.role_mgr_a),      # Sam is a barista
        rec(world.staff_a, MON, role_id=world.role_owner_b),    # other company's role
        rec(world.staff_a, MON - timedelta(days=14)),           # in the past
        rec(world.staff_a, MON + timedelta(days=1), "09:00", "09:30"),  # too short
    ])
    assert "role is Barista, not Manager" in results[0][1][0]
    assert any("isn't defined at this location" in f for f in results[1][1])
    assert any("past" in f for f in results[2][1])
    assert any("outside the allowed" in f for f in results[3][1])


def test_validator_rejects_dates_outside_requested_week(app, world):
    availability(app, world.staff_a)
    [(ok, failures, _)] = validate(app, world, [rec(world.staff_a, MON + timedelta(days=7))], week=MON)
    assert not ok and any("outside the requested week" in f for f in failures)


# ── Schedule copilot endpoints ────────────────────────────────────────────────

def test_generate_requires_plan_and_manager(app, client, world, ai_on, nvidia):
    fake = nvidia()
    body = {"location_id": world.loc_a, "week_start": MON.isoformat()}
    assert client.post("/ai/schedule/generate", json=body, headers=world.headers(world.manager_a)).status_code == 403
    set_plan(app, world.comp_a, "advanced")
    assert client.post("/ai/schedule/generate", json=body, headers=world.headers(world.staff_a)).status_code == 403
    assert client.post("/ai/schedule/generate", json={**body, "location_id": world.loc_b},
                       headers=world.headers(world.manager_a)).status_code == 403
    assert fake.requests == []


def test_generate_validates_and_saves_nothing(app, client, world, ai_on, nvidia):
    set_plan(app, world.comp_a, "advanced")
    availability(app, world.staff_a)
    availability(app, world.staff_a2, start=time(12), end=time(20))
    employment(app, world.staff_a, hourly_rate=20)
    open_shift = world.shift(world.loc_a, next_monday() + timedelta(days=2, hours=10), hours=6)
    before = shift_count(app)

    def propose(payload):
        prompt = payload["messages"][1]["content"]
        data = json.loads(prompt[prompt.index("Data:\n") + 6: prompt.rindex("\n\nCall")])
        ids = {s["name"]: s["user_id"] for s in data["staff"]}
        assert {s["shift_id"] for s in data["existing_shifts"]} == {open_shift}
        assert "user_email" not in prompt and "@a.test" not in prompt  # no unnecessary PII
        return tool_call("propose_schedule", {"summary": "Covered the week.", "shifts": [
            rec(ids["Sam Staff"], MON, "09:00", "17:00"),                       # valid
            rec(ids["Ria Barista"], MON, "08:00", "16:00"),                     # outside availability
            rec(ids["Sam Staff"], MON + timedelta(days=2), "00:00", "00:00", existing_shift_id=open_shift),  # fills open shift
            rec(world.owner_b, MON + timedelta(days=3)),                        # other company
        ]})

    fake = nvidia(propose)
    res = client.post("/ai/schedule/generate", json={"location_id": world.loc_a, "week_start": MON.isoformat(),
                                                     "labor_budget": 500}, headers=world.headers(world.manager_a))
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert fake.requests[0]["json"]["tool_choice"]["function"]["name"] == "propose_schedule"
    valid = [r["valid"] for r in body["recommendations"]]
    assert valid == [True, False, True, False]
    filled = body["recommendations"][2]
    assert (filled["start_time"], filled["end_time"]) == ("10:00", "16:00")  # the shift's real times
    m = body["metrics"]
    assert (m["proposed"], m["valid"], m["rejected"]) == (4, 2, 2)
    # Backend math: today the open shift is costed 6h × $15 = $90. Adding Sam's 8h × $20 = $160
    # and moving the open shift to his rate (6h × $20 = $120 instead of $90) gives $280.
    assert m["current_labor_cost"] == 90.0 and m["projected_labor_cost"] == 280.0
    assert m["budget_variance"] == -220.0
    assert m["coverage"] == {"basis": "open shifts", "covered": 1, "required": 1, "pct": 100.0}
    assert shift_count(app) == before  # generation never writes


def test_generate_malformed_output(app, client, world, ai_on, nvidia):
    set_plan(app, world.comp_a, "advanced")
    nvidia(tool_call("propose_schedule", {"shifts": [{"user_id": "Sam", "date": "Monday"}]}))
    res = client.post("/ai/schedule/generate", json={"location_id": world.loc_a, "week_start": MON.isoformat()},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 502 and res.get_json()["code"] == "AI_BAD_RESPONSE"


def test_generate_coverage_against_requirements(app, client, world, ai_on, nvidia):
    set_plan(app, world.comp_a, "advanced")
    availability(app, world.staff_a)
    availability(app, world.staff_a2)
    nvidia(tool_call("propose_schedule", {"summary": "", "shifts": [
        rec(world.staff_a, MON, "16:00", "23:00"), rec(world.staff_a2, MON, "17:00", "22:00")]}))
    res = client.post("/ai/schedule/generate", json={
        "location_id": world.loc_a, "week_start": MON.isoformat(),
        "requirements": [{"days": ["mon", "tue"], "start_time": "17:00", "end_time": "22:00", "headcount": 2}]},
        headers=world.headers(world.manager_a))
    cov = res.get_json()["metrics"]["coverage"]
    assert cov == {"basis": "staffing requirements", "covered": 2, "required": 4, "pct": 50.0}


def test_apply_rejects_invalid_and_creates_nothing(app, client, world, nvidia):
    set_plan(app, world.comp_a, "advanced")
    availability(app, world.staff_a)
    time_off(app, world.staff_a2, world.comp_a, MON)
    before = shift_count(app)
    fake = nvidia()
    res = client.post("/ai/schedule/apply", json={"location_id": world.loc_a, "shifts": [
        rec(world.staff_a, MON), rec(world.staff_a2, MON)]}, headers=world.headers(world.manager_a))
    assert res.status_code == 422
    body = res.get_json()
    assert body["applied"] is False and [r["valid"] for r in body["results"]] == [True, False]
    assert shift_count(app) == before and fake.requests == []  # apply never calls the model


def test_apply_creates_drafts_through_existing_flow(app, client, world):
    set_plan(app, world.comp_a, "advanced")
    availability(app, world.staff_a, start=time(0))
    open_shift = world.shift(world.loc_a, next_monday() + timedelta(days=1, hours=10), hours=6)
    res = client.post("/ai/schedule/apply", json={"location_id": world.loc_a, "shifts": [
        rec(world.staff_a, MON, "22:00", "02:00"),
        rec(world.staff_a, MON + timedelta(days=1), "10:00", "16:00", existing_shift_id=open_shift)]},
        headers=world.headers(world.manager_a))
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert len(body["created_shift_ids"]) == 1 and body["assigned_existing_shift_ids"] == [open_shift]
    with app.app_context():
        s = Shift.query.get(body["created_shift_ids"][0])
        assert s.status == "draft" and s.created_by_ai
        assert s.start_time == datetime.combine(MON, time(22)).replace(tzinfo=s.start_time.tzinfo)
        assert (s.end_time - s.start_time) == timedelta(hours=4)  # overnight
        assert ShiftAssignment.query.filter_by(shift_id=s.shift_id, user_id=world.staff_a).first()
        assert ShiftAssignment.query.filter_by(shift_id=open_shift, user_id=world.staff_a).first()
    # Publishing is still the existing, separate manager action.
    pub = client.post("/shifts/publish", json={"location_id": world.loc_a, "week_start": MON.isoformat()},
                      headers=world.headers(world.manager_a))
    assert pub.status_code == 200 and pub.get_json()["published_count"] == 2


def test_apply_tenant_isolation(app, client, world):
    set_plan(app, world.comp_b, "advanced")
    res = client.post("/ai/schedule/apply", json={"location_id": world.loc_b, "shifts": [rec(world.owner_b, MON)]},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 403


# ── Insights ──────────────────────────────────────────────────────────────────

def test_insights_facts_work_without_ai(app, client, world):
    availability(app, world.staff_a2)
    employment(app, world.staff_a, hourly_rate=20)
    world.shift(world.loc_a, next_monday() + timedelta(hours=9), hours=6)  # open
    for i in range(5):  # 45h for Sam → overtime
        world.shift(world.loc_a, next_monday() + timedelta(days=i, hours=8), hours=9, assign=[world.staff_a])
    res = client.get(f"/ai/insights?location_id={world.loc_a}&week_start={MON.isoformat()}&budget=800&ai=1",
                     headers=world.headers(world.manager_a))
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    f = body["facts"]
    assert f["labor"]["projected_cost"] == 990.0  # 45h × $20 + 6h × $15
    assert f["labor"]["variance"] == 190.0
    types = {i["type"] for i in f["issues"]}
    assert {"open_shifts", "overtime", "over_budget", "conflicts"} <= types
    assert [e["name"] for e in f["overtime"]] == ["Sam Staff"]
    assert any(e["name"] == "Ria Barista" for e in f["underused_availability"])
    assert all(e["name"] != "Sam Staff" for e in f["underused_availability"])  # already in overtime
    assert any(c["detail"].startswith("Sam Staff has 45.0 h") for c in f["conflicts"])
    assert body["ai"]["status"] == "error" and body["ai"]["code"] == "AI_NOT_CONFIGURED"


def test_insights_ai_recommendations_are_separate_from_facts(app, client, world, ai_on, nvidia):
    fake = nvidia(tool_call("submit_recommendations", {"recommendations": ["Consider assigning the open Monday shift."]}))
    res = client.get(f"/ai/insights?location_id={world.loc_a}&ai=1", headers=world.headers(world.manager_a))
    body = res.get_json()
    assert body["ai"] == {"status": "ok", "recommendations": ["Consider assigning the open Monday shift."], "model": "nvidia/test-nemotron"}
    assert "projected_cost" in fake.requests[0]["json"]["messages"][0]["content"]


def test_insights_tenant_and_role(client, world):
    assert client.get(f"/ai/insights?location_id={world.loc_b}", headers=world.headers(world.manager_a)).status_code == 403
    assert client.get(f"/ai/insights?location_id={world.loc_a}", headers=world.headers(world.staff_a)).status_code == 403


def test_swap_recommendations_scoped_to_location(app, client, world):
    set_plan(app, world.comp_a, "professional")
    from models import ShiftSwap
    shift_b = world.shift(world.loc_b, next_monday() + timedelta(hours=9), assign=[world.owner_b])
    with app.app_context():
        swap = ShiftSwap(shift_id=shift_b, requesting_user_id=world.owner_b)
        db.session.add(swap)
        db.session.commit()
        swap_id = swap.swap_id
    # Manager A naming their own location can't pull B's swap.
    res = client.post("/ai/swap-recommendations", json={"swap_id": swap_id, "location_id": world.loc_a},
                      headers=world.headers(world.manager_a))
    assert res.status_code == 404
