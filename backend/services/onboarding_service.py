# services/onboarding_service.py
from datetime import date
from typing import Tuple
import secrets
from extensions import db
from models import OnboardingInvite, Company, Location, AppUser, Employment, Role
from utils.security import hash_password
from utils.mailer import send_onboarding_email


class OnboardingService:

    @staticmethod
    def _send_credentials(*, email, temp_password, company, location) -> bool:
        """Email the login details. True only if the mail server accepted the message."""
        try:
            return bool(send_onboarding_email(
                to_email=email,
                temp_password=temp_password,
                company_name=company.comp_name,
                location_name=location.loc_name,
            ))
        except Exception:
            from flask import current_app
            current_app.logger.exception("Failed to send onboarding email")
            return False

    def create_invite(self, *, company, location, email, position) -> Tuple[OnboardingInvite, AppUser, bool, str]:
        """Returns (invite, user, email_sent, temp_password). The caller decides whether the
        temporary password may be shown to the manager (only when the email didn't go out)."""
        normalized_email = (email or "").strip().lower()
        if not normalized_email:
            raise ValueError("Email is required")

        temp_password = secrets.token_urlsafe(8)
        password_hash = hash_password(temp_password)

        # Find or create role
        role = Role.query.filter_by(location_id=location.loc_id, name=position.strip()).first()
        if not role:
            role = Role(name=position.strip(), location_id=location.loc_id, is_system=False)
            db.session.add(role)
            db.session.flush()

        user = AppUser.query.filter_by(user_email=normalized_email).first()
        if user:
            # Never reset the password of an account that belongs to another company —
            # any manager could otherwise lock out (or hijack the onboarding of) a stranger.
            other_company = any(
                e.comp_id != company.comp_id for e in user.employments
            )
            if other_company:
                raise ValueError(
                    "This email already has a ProShifts account with another company."
                )
            user.user_password = password_hash
            if not user.is_verified:
                user.is_verified = True
        else:
            user = AppUser(
                username=normalized_email,
                user_email=normalized_email,
                user_password=password_hash,
                is_verified=True,
            )
            db.session.add(user)
            db.session.flush()

        employment = Employment.query.filter_by(
            user_id=user.user_id, comp_id=company.comp_id, location_id=location.loc_id
        ).first()
        if employment:
            employment.role_id = role.role_id
            employment.status  = "active"
        else:
            employment = Employment(
                user_id=user.user_id,
                comp_id=company.comp_id,
                location_id=location.loc_id,
                role_id=role.role_id,
                status="active",
                start_date=date.today(),
            )
            db.session.add(employment)

        invite = OnboardingInvite(
            comp_id=company.comp_id,
            location_id=location.loc_id,
            email=normalized_email,
            status="sent",
        )
        db.session.add(invite)
        db.session.commit()

        # A new (or returning) employee joins the location's #general automatically.
        try:
            from services.messaging_service import MessagingService
            MessagingService().on_employment_changed(user.user_id, location.loc_id)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Couldn't add the new employee to #general")

        email_sent = self._send_credentials(
            email=normalized_email, temp_password=temp_password, company=company, location=location
        )
        return invite, user, email_sent, temp_password

    def resend_invite(self, *, company, location, user) -> Tuple[bool, str]:
        """Issue a fresh temporary password for an invited employee and email it again.
        Returns (email_sent, temp_password). The caller has already checked permissions."""
        temp_password = secrets.token_urlsafe(8)
        user.user_password = hash_password(temp_password)
        user.is_verified = True
        db.session.commit()
        email_sent = self._send_credentials(
            email=user.user_email, temp_password=temp_password, company=company, location=location
        )
        return email_sent, temp_password

    def accept_invite(self, *args, **kwargs):
        raise ValueError("Token-based invite flow is no longer supported.")

    def prevalidate(self, *args, **kwargs):
        raise ValueError("Token-based invite flow is no longer supported.")