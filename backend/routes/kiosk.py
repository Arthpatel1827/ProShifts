# routes/kiosk.py
"""Personal clock-in PINs and the punch-in tablet."""
import hashlib

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from extensions import limiter
from services.kiosk_service import INVALID_PIN, KioskLocked, KioskNotConfigured, KioskService

router = Blueprint("kiosk", __name__, url_prefix="/kiosk")
svc = KioskService()


def _device_key():
    """Rate-limit punches per tablet (all tablets reach Flask through the same web server)."""
    token = request.headers.get("X-Kiosk-Token", "")
    return "kiosk:" + hashlib.sha256(token.encode()).hexdigest()[:24] if token else f"kiosk-anon:{request.remote_addr}"


def _err(e, code):
    return jsonify({"error": str(e)}), code


@router.errorhandler(KioskNotConfigured)
def _not_configured(e):
    return jsonify({"error": str(e), "code": e.code}), 503


# ── The employee's own PIN ────────────────────────────────────────────────────
@router.get("/pin")
@jwt_required()
def pin_status():
    return jsonify(svc.pin_status(int(get_jwt_identity()))), 200


@router.put("/pin")
@jwt_required()
@limiter.limit("10 per hour")
def set_pin():
    d = request.get_json(silent=True) or {}
    try:
        return jsonify(svc.set_pin(int(get_jwt_identity()), d.get("pin"), d.get("confirm"))), 200
    except PermissionError as e:
        return _err(e, 403)
    except ValueError as e:
        return _err(e, 400)


@router.delete("/pin/<int:user_id>")
@jwt_required()
def reset_pin(user_id):
    try:
        svc.clear_pin(manager_user_id=int(get_jwt_identity()), target_user_id=user_id)
        return jsonify({"message": "PIN reset. They can set a new one in the app."}), 200
    except PermissionError as e:
        return _err(e, 403)
    except ValueError as e:
        return _err(e, 404)


# ── Tablets (managers) ────────────────────────────────────────────────────────
@router.post("/devices")
@jwt_required()
@limiter.limit("20 per hour")
def create_device():
    d = request.get_json(silent=True) or {}
    try:
        dev, token = svc.create_device(manager_user_id=int(get_jwt_identity()),
                                       location_id=int(d.get("location_id") or 0), name=d.get("name"))
        return jsonify({"device": svc.serialize_device(dev), "token": token}), 201
    except PermissionError as e:
        return _err(e, 403)


@router.get("/devices")
@jwt_required()
def list_devices():
    try:
        devs = svc.list_devices(manager_user_id=int(get_jwt_identity()),
                                location_id=request.args.get("location_id", type=int) or 0)
        return jsonify({"devices": [svc.serialize_device(x) for x in devs]}), 200
    except PermissionError as e:
        return _err(e, 403)


@router.delete("/devices/<int:device_id>")
@jwt_required()
def revoke_device(device_id):
    try:
        svc.revoke_device(manager_user_id=int(get_jwt_identity()), device_id=device_id)
        return jsonify({"message": "Tablet removed"}), 200
    except PermissionError as e:
        return _err(e, 403)
    except ValueError as e:
        return _err(e, 404)


# ── The tablet itself (device token, no user login) ───────────────────────────
@router.get("/session")
@limiter.limit("60 per minute", key_func=_device_key)
def session():
    dev = svc.device_for_token(request.headers.get("X-Kiosk-Token", ""))
    if not dev:
        return jsonify({"error": "This tablet isn't set up. Ask a manager."}), 401
    loc = dev.location
    return jsonify({
        "device": dev.name,
        "location": loc.loc_name if loc else None,
        "company": loc.company.comp_name if loc and loc.company else None,
        "timezone": loc.timezone if loc else "UTC",
    }), 200


@router.post("/punch")
@limiter.limit("12 per minute;150 per hour", key_func=_device_key)
def punch():
    dev = svc.device_for_token(request.headers.get("X-Kiosk-Token", ""))
    if not dev:
        return jsonify({"error": "This tablet isn't set up. Ask a manager."}), 401
    d = request.get_json(silent=True) or {}
    try:
        return jsonify(svc.punch(dev, d.get("pin"), d.get("action") or "auto")), 200
    except KioskLocked as e:
        return _err(e, 423)
    except ValueError as e:
        # INVALID_PIN for anything about who you are; rule messages (too early…) otherwise.
        return jsonify({"error": str(e), "code": "INVALID_PIN" if str(e) == INVALID_PIN else "NOT_ALLOWED"}), 400
