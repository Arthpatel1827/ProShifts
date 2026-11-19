# routes/onboarding.py
from flask import Blueprint
from controllers.onboarding_controller import OnboardingController
from flask_jwt_extended import jwt_required
from extensions import limiter

router = Blueprint("onboarding", __name__, url_prefix="/onboarding")
ctrl = OnboardingController()

# Manager/Owner creates invite
@router.post("/invite")
@jwt_required()
def create_invite():
    return ctrl.create_invite()

# Manager/Owner sends new login details to an invited employee (resets their password)
@router.post("/invite/resend")
@jwt_required()
@limiter.limit("20 per hour")
def resend_invite():
    return ctrl.resend_invite()

# Public: prevalidate an invite token (for the wizard screen)
@router.get("/validate")
def prevalidate():
    return ctrl.prevalidate()

# Public: accept invite, set password, create/attach user+employment
@router.post("/accept")
def accept():
    return ctrl.accept()
