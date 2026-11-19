# controllers/ai_controller.py
"""
AI endpoints. Every one requires a JWT, then a manager role AT the requested location
(require_location_role) — so a manager at company A can't reach company B's data by
changing location_id. AI failures return a clean error; nothing else breaks.
"""
from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity
from pydantic import ValidationError

from ai import assistant, insights, schedule_copilot
from ai.client import AIError
from ai.config import get_settings
from ai.schemas import ApplyRequest, GenerateRequest
from ai.tools import AIContext, ToolError
from models import Location
from services.ai_service import AIService
from services.rbac_service import require_location_role

ai_svc = AIService()
_PLANS = ["free", "advanced", "professional"]
MANUAL_FALLBACK = "You can continue scheduling manually."


def _plan_of(location) -> str:
    plan = (location.company.plan if location and location.company else "free") or "free"
    return plan.lower() if plan.lower() in _PLANS else "free"


def _manager_ctx(location_id, min_plan="free"):
    """(AIContext, None) or (None, error response)."""
    try:
        location_id = int(location_id)
    except (TypeError, ValueError):
        return None, (jsonify({"error": "location_id is required"}), 400)
    caller = int(get_jwt_identity())
    try:
        require_location_role(caller, location_id)
    except PermissionError:
        return None, (jsonify({"error": "Forbidden"}), 403)
    location = Location.query.get(location_id)
    if not location:
        return None, (jsonify({"error": "Location not found"}), 404)
    plan = _plan_of(location)
    if _PLANS.index(plan) < _PLANS.index(min_plan):
        return None, (jsonify({"error": "Plan upgrade required", "current_plan": plan, "required_plan": min_plan}), 403)
    return AIContext(location=location, caller_user_id=caller), None


def _ai_error(e: AIError):
    return jsonify({"error": e.message, "code": e.code, "fallback": MANUAL_FALLBACK}), e.status


def _bad_input(e: ValidationError):
    first = e.errors()[0] if e.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ()))
    return jsonify({"error": f"Invalid {where or 'request'}: {first.get('msg', 'bad value')}"}), 400


class AIController:

    def status(self):
        ctx, err = _manager_ctx(request.args.get("location_id"))
        if err:
            return err
        s = get_settings()
        return jsonify({"configured": s.configured, "provider": "NVIDIA Nemotron", "model": s.model,
                        "plan": _plan_of(ctx.location)}), 200

    # ── Workforce assistant ───────────────────────────────────────────────────
    def assistant(self):
        data = request.get_json(silent=True) or {}
        message = (data.get("message") or "").strip()
        if not message:
            return jsonify({"error": "message is required"}), 400
        ctx, err = _manager_ctx(data.get("location_id"))
        if err:
            return err
        try:
            return jsonify(assistant.ask(ctx, message, data.get("history"))), 200
        except AIError as e:
            return _ai_error(e)

    def chat(self):
        """Mobile app's AI screen. Same read-only assistant; it no longer creates shifts."""
        resp = self.assistant()
        body, status = resp if isinstance(resp, tuple) else (resp, 200)
        if status != 200:
            return body, status
        payload = body.get_json()
        payload.update(can_write=False, executed_shifts=[])
        return jsonify(payload), 200

    # ── Schedule copilot ──────────────────────────────────────────────────────
    def generate_schedule(self):
        try:
            req = GenerateRequest.model_validate(request.get_json(silent=True) or {})
        except ValidationError as e:
            return _bad_input(e)
        ctx, err = _manager_ctx(req.location_id, min_plan="advanced")
        if err:
            return err
        try:
            return jsonify(schedule_copilot.generate(ctx, req)), 200
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except AIError as e:
            return _ai_error(e)

    def apply_schedule(self):
        try:
            req = ApplyRequest.model_validate(request.get_json(silent=True) or {})
        except ValidationError as e:
            return _bad_input(e)
        ctx, err = _manager_ctx(req.location_id, min_plan="advanced")
        if err:
            return err
        body, status = schedule_copilot.apply(ctx, req)
        return jsonify(body), status

    # ── Insights ──────────────────────────────────────────────────────────────
    def insights(self):
        ctx, err = _manager_ctx(request.args.get("location_id"))
        if err:
            return err
        budget = request.args.get("budget", type=float)
        if budget is not None and budget <= 0:
            return jsonify({"error": "budget must be positive"}), 400
        week = request.args.get("week_start")
        try:
            data = insights.facts(ctx, week, budget)
        except ToolError as e:  # bad week_start
            return jsonify({"error": str(e)}), 400
        out = {"facts": data, "ai": None}
        if request.args.get("ai") in ("1", "true"):
            try:
                out["ai"] = {"status": "ok", **insights.recommend(ctx, data)}
            except AIError as e:
                out["ai"] = {"status": "error", "code": e.code, "error": e.message}
        return jsonify(out), 200

    # ── Older endpoints ───────────────────────────────────────────────────────
    def predict_staffing(self):
        data = request.get_json(silent=True) or {}
        target_week = data.get("week_start")
        if not target_week:
            return jsonify({"error": "location_id and week_start are required"}), 400
        ctx, err = _manager_ctx(data.get("location_id"), min_plan="advanced")
        if err:
            return err
        if not get_settings().configured:
            return jsonify({"error": "AI isn't configured on this server (NVIDIA_API_KEY is not set).",
                            "code": "AI_NOT_CONFIGURED", "fallback": MANUAL_FALLBACK}), 503
        from workers.tasks import run_staffing_prediction_task
        task = run_staffing_prediction_task.delay(location_id=ctx.location_id, target_week=target_week,
                                                  manager_user_id=ctx.caller_user_id)
        return jsonify({"message": "Prediction running.", "job_id": task.id, "status": "queued"}), 202

    def job_status(self, job_id):
        from workers.tasks import run_staffing_prediction_task
        result = run_staffing_prediction_task.AsyncResult(job_id)
        payload = result.result if result.ready() and isinstance(result.result, dict) else None
        # Results carry their location; only that location's managers may read them.
        if payload is not None:
            _, err = _manager_ctx(payload.get("location_id"))
            if err:
                return jsonify({"error": "Forbidden"}), 403
        return jsonify({"job_id": job_id, "status": result.status, "result": payload}), 200

    def swap_recommendations(self):
        data = request.get_json(silent=True) or {}
        swap_id = data.get("swap_id")
        if not swap_id:
            return jsonify({"error": "swap_id and location_id are required"}), 400
        ctx, err = _manager_ctx(data.get("location_id"), min_plan="professional")
        if err:
            return err
        try:
            return jsonify({"candidates": ai_svc.recommend_swap_matches(
                swap_id=int(swap_id), location_id=ctx.location_id, caller_user_id=ctx.caller_user_id)}), 200
        except LookupError as e:
            return jsonify({"error": str(e)}), 404
