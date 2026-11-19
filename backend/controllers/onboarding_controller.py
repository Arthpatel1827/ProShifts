# controllers/onboarding_controller.py
from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity
from services.onboarding_service import OnboardingService
from models import Employment, Location, OnboardingInvite
from services.rbac_service import APPROVER_ROLES, require_location_role


def _delivery(email_sent: bool, temp_password: str) -> dict:
    """The temporary password goes back to the manager ONLY when the email didn't go out,
    so they can pass it on in person. When it was emailed, it is never returned."""
    out = {"email_sent": bool(email_sent)}
    if not email_sent:
        out["temp_password"] = temp_password
    return out


class OnboardingController:
    def __init__(self):
        self.svc = OnboardingService()

    # Manager/Owner endpoint: invite staff
    def create_invite(self):
        data = request.get_json(silent=True) or {}

        email = (data.get("email") or "").strip().lower()
        location_id = data.get("location_id")
        position = (data.get("position") or "Staff").strip()

        # NEW: we *don't* require comp_id anymore – we derive it from caller.
        if not email or not location_id:
            return jsonify({"error": "email and location_id are required"}), 400

        # Who is calling this?
        try:
            caller_id = int(get_jwt_identity())
        except (TypeError, ValueError):
            return jsonify({"error": "Unauthorized"}), 401

        # Employment.position was replaced by role_id (migration 707f52f0a927); reading it
        # raised AttributeError. Mirror the GraphQL resolver: owner/manager at this location.
        try:
            location_id = int(location_id)
        except (TypeError, ValueError):
            return jsonify({"error": "location_id must be a number"}), 400
        try:
            admin_emp = require_location_role(caller_id, location_id, APPROVER_ROLES)
        except PermissionError:
            return jsonify({"error": "Only an owner or manager at this location can invite staff"}), 403
        comp_id = admin_emp.comp_id

        if position.lower() == "owner" and admin_emp.role.name.lower() != "owner":
            return jsonify({"error": "Only an owner can invite another owner"}), 403
        if len(position) > 50:
            return jsonify({"error": "Role name is too long"}), 400

        if OnboardingInvite.query.filter_by(email=email, location_id=location_id, status="sent").first():
            return jsonify({"error": "An invite has already been sent to this email. Use Resend invite on the Team page to send new login details."}), 400

        # Ensure the chosen location belongs to this company
        location = (
            Location.query
            .filter_by(loc_id=location_id, comp_id=comp_id)
            .first()
        )
        if not location:
            return jsonify({"error": "Invalid location_id for this company"}), 400

        try:
            invite, user, email_sent, temp_password = self.svc.create_invite(
                company=location.company,
                location=location,
                email=email,
                position=position,
            )
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            from flask import current_app
            current_app.logger.exception("Error creating onboarding invite")
            return jsonify({"error": "Something went wrong"}), 500

        return jsonify({
            "message": "Onboarding email sent." if email_sent else "Invite created, but the email was not sent.",
            "result": {
                "user_id": int(user.user_id),
                "invite_id": int(invite.form_id),
                "email": email,
                **_delivery(email_sent, temp_password),
            },
        }), 200

    # Manager/Owner endpoint: send new login details to someone already invited
    def resend_invite(self):
        data = request.get_json(silent=True) or {}
        try:
            caller_id = int(get_jwt_identity())
            user_id = int(data.get("user_id"))
            location_id = int(data.get("location_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "user_id and location_id are required"}), 400

        try:
            caller_emp = require_location_role(caller_id, location_id, APPROVER_ROLES)
        except PermissionError:
            return jsonify({"error": "Only an owner or manager at this location can resend invites"}), 403
        if user_id == caller_id:
            return jsonify({"error": "You can't resend an invite to yourself. Change your password from your profile instead."}), 400

        # Same location (and so same company); other tenants' users look like "not found".
        target = Employment.query.filter_by(user_id=user_id, location_id=location_id, comp_id=caller_emp.comp_id).first()
        if not target or not target.user:
            return jsonify({"error": "Employee not found at this location"}), 404
        if target.status != "active":
            return jsonify({"error": "This employee is inactive. Reactivate them before resending the invite."}), 400

        # Resending resets the password, so it must never become a way to take over a
        # more senior account.
        target_role = (target.role.name if target.role else "").lower()
        caller_role = (caller_emp.role.name if caller_emp.role else "").lower()
        if target_role == "owner":
            return jsonify({"error": "Owners can't be re-invited."}), 403
        if target_role in ("manager", "supervisor") and caller_role != "owner":
            return jsonify({"error": "Only an owner can resend an invite to a manager or supervisor."}), 403

        if not OnboardingInvite.query.filter_by(email=target.user.user_email, location_id=location_id).first():
            return jsonify({"error": "This person wasn't invited by email, so there's no invite to resend. They can reset their password from the mobile app."}), 400

        location = Location.query.get(location_id)
        try:
            email_sent, temp_password = self.svc.resend_invite(company=location.company, location=location, user=target.user)
        except Exception:
            from flask import current_app
            current_app.logger.exception("Error resending onboarding invite")
            return jsonify({"error": "Something went wrong"}), 500

        return jsonify({
            "message": "New login details emailed." if email_sent else "New login details created, but the email was not sent.",
            "result": {"user_id": user_id, "email": target.user.user_email, **_delivery(email_sent, temp_password)},
        }), 200

    # Public endpoint: prevalidate invite link (legacy / if you still want it)
    def prevalidate(self):
        token = (request.args.get("token") or "").strip()
        if not token:
            return jsonify({"error": "token required"}), 400
        try:
            info = self.svc.prevalidate(token)
            return jsonify(info)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    # Public endpoint: accept invite and set password (legacy flow)
    def accept(self):
        data = request.get_json() or {}
        token = data.get("token")
        username = data.get("username")
        password = data.get("password")
        confirm = data.get("confirm_password")

        if not token or not username or not password or not confirm:
            return jsonify({"error": "token, username, password, confirm_password are required"}), 400

        try:
            result = self.svc.accept_invite(token, username, password, confirm)
            return jsonify(result), 201
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
