# routes/ai.py
from flask import Blueprint
from flask_jwt_extended import jwt_required
from controllers.ai_controller import AIController
from extensions import limiter

router = Blueprint("ai", __name__, url_prefix="/ai")
ctrl   = AIController()


@router.get("/status")
@jwt_required()
def status():
    return ctrl.status()


@router.post("/assistant")
@jwt_required()
@limiter.limit("60 per hour")
def assistant():
    return ctrl.assistant()


@router.post("/chat")  # mobile AI screen; same read-only assistant
@jwt_required()
@limiter.limit("60 per hour")
def chat():
    return ctrl.chat()


@router.post("/schedule/generate")
@jwt_required()
@limiter.limit("20 per hour")
def generate_schedule():
    return ctrl.generate_schedule()


@router.post("/generate-schedule")  # older path, same copilot (returns recommendations, saves nothing)
@jwt_required()
@limiter.limit("20 per hour")
def generate_schedule_legacy():
    return ctrl.generate_schedule()


@router.post("/schedule/apply")
@jwt_required()
@limiter.limit("60 per hour")
def apply_schedule():
    return ctrl.apply_schedule()


@router.get("/insights")
@jwt_required()
@limiter.limit("120 per hour")
def insights():
    return ctrl.insights()


@router.get("/job/<string:job_id>")
@jwt_required()
def job_status(job_id):
    return ctrl.job_status(job_id)


@router.post("/predict-staffing")
@jwt_required()
@limiter.limit("20 per hour")
def predict_staffing():
    return ctrl.predict_staffing()


@router.post("/swap-recommendations")
@jwt_required()
@limiter.limit("30 per hour")
def swap_recommendations():
    return ctrl.swap_recommendations()
