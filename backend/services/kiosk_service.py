# services/kiosk_service.py
"""
Punch-in tablet ("kiosk") and personal 4-digit clock-in PINs.

PINs
  - Stored as HMAC-SHA256(KIOSK_PIN_SECRET, "<company>:<pin>"), never the PIN. With only
    10,000 possible PINs a plain hash would be reversible from a database copy; the
    server-side key prevents that. The same PIN in two companies hashes differently.
  - Unique within a company, so a PIN identifies one person at the tablet.
  - Never returned to anyone (managers see only whether one is set) and never logged.

Tablets
  - A manager sets a device up for a location; it gets a random token (stored hashed).
  - Every punch is rate limited per device, and a device locks for a few minutes after
    repeated wrong PINs. Wrong PINs, PINs from another company or location, and inactive
    staff all get the same "Invalid PIN." so nothing can be learned by guessing.
  - Punches go through TimeEntryService (scheduled-shift and clock-in window rules,
    manager-only mode, break limits); the tablet itself stands in for phone GPS.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta

from flask import current_app

from extensions import db
from models import Employment, KioskDevice, Location, Shift, ShiftAssignment
from services.time_entry_service import TimeEntryService
from utils import timezones as tzu

log = logging.getLogger("proshifts.audit")
time_svc = TimeEntryService()

INVALID_PIN = "Invalid PIN."
MAX_FAILS = 5
LOCK_MINUTES = 5
# Trivial PINs everyone tries first.
WEAK_PINS = {"0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
             "1234", "4321", "0123", "2345", "3456", "4567", "5678", "6789", "9876", "1212", "1122", "0007"}


class KioskLocked(PermissionError):
    pass


def pin_hash(comp_id: int, pin: str) -> str:
    key = (current_app.config.get("KIOSK_PIN_SECRET") or current_app.config["JWT_SECRET_KEY"]).encode()
    return hmac.new(key, f"{comp_id}:{pin}".encode(), hashlib.sha256).hexdigest()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class KioskService:

    # ── Personal PIN (the employee sets it) ───────────────────────────────────
    def pin_status(self, user_id: int) -> dict:
        emps = Employment.query.filter_by(user_id=user_id, status="active").all()
        set_at = [e.kiosk_pin_set_at for e in emps if e.kiosk_pin_hash and e.kiosk_pin_set_at]
        return {"is_set": bool(set_at), "set_at": max(set_at).isoformat() if set_at else None}

    def set_pin(self, user_id: int, pin: str, confirm: str) -> dict:
        pin, confirm = str(pin or ""), str(confirm or "")
        if len(pin) != 4 or not pin.isdigit():
            raise ValueError("Your PIN must be exactly 4 digits.")
        if pin != confirm:
            raise ValueError("The two PINs don't match.")
        if pin in WEAK_PINS:
            raise ValueError("That PIN is too easy to guess. Choose another.")
        emps = Employment.query.filter_by(user_id=user_id, status="active").all()
        if not emps:
            raise PermissionError("You need an active job to set a clock-in PIN.")
        for comp_id in {e.comp_id for e in emps}:
            h = pin_hash(comp_id, pin)
            taken = Employment.query.filter(
                Employment.comp_id == comp_id, Employment.kiosk_pin_hash == h,
                Employment.user_id != user_id,
            ).first()
            if taken:
                # Doesn't say whose. Setting a PIN is rate limited, so this can't be used
                # to map out everyone's PINs.
                raise ValueError("That PIN isn't available. Choose another.")
        now = datetime.utcnow()
        for e in emps:
            e.kiosk_pin_hash = pin_hash(e.comp_id, pin)
            e.kiosk_pin_set_at = now
        db.session.commit()
        log.info("clock-in PIN set by user %s", user_id)  # never the PIN
        return self.pin_status(user_id)

    def clear_pin(self, *, manager_user_id: int, target_user_id: int) -> None:
        """A manager resets a forgotten PIN (they never see it); the employee sets a new one."""
        from services.rbac_service import APPROVER_ROLES, company_role_employment
        mgr = company_role_employment(manager_user_id, APPROVER_ROLES)
        if not mgr:
            raise PermissionError("Only an owner or manager can reset a clock-in PIN.")
        emps = Employment.query.filter_by(user_id=target_user_id, comp_id=mgr.comp_id).all()
        if not emps:
            raise ValueError("Employee not found")
        for e in emps:
            e.kiosk_pin_hash = None
            e.kiosk_pin_set_at = None
        db.session.commit()
        log.info("clock-in PIN of user %s reset by user %s", target_user_id, manager_user_id)

    # ── Devices (a manager sets them up) ──────────────────────────────────────
    def create_device(self, *, manager_user_id: int, location_id: int, name: str) -> tuple:
        from services.rbac_service import APPROVER_ROLES, require_location_role
        require_location_role(manager_user_id, location_id, APPROVER_ROLES)
        name = (name or "").strip()[:60] or "Punch-in tablet"
        token = secrets.token_urlsafe(32)
        dev = KioskDevice(location_id=location_id, name=name, token_hash=_token_hash(token), created_by=manager_user_id)
        db.session.add(dev)
        db.session.commit()
        log.info("kiosk device %s created at location %s by user %s", dev.device_id, location_id, manager_user_id)
        return dev, token  # the token is shown once, to the tablet

    def list_devices(self, *, manager_user_id: int, location_id: int):
        from services.rbac_service import APPROVER_ROLES, require_location_role
        require_location_role(manager_user_id, location_id, APPROVER_ROLES)
        return KioskDevice.query.filter_by(location_id=location_id, revoked_at=None).order_by(KioskDevice.created_at).all()

    def revoke_device(self, *, manager_user_id: int, device_id: int):
        from services.rbac_service import APPROVER_ROLES, require_location_role
        dev = KioskDevice.query.get(device_id)
        if not dev:
            raise ValueError("Tablet not found")
        require_location_role(manager_user_id, dev.location_id, APPROVER_ROLES)
        dev.revoked_at = datetime.utcnow()
        db.session.commit()
        log.info("kiosk device %s revoked by user %s", device_id, manager_user_id)

    def device_for_token(self, token: str):
        if not token:
            return None
        dev = KioskDevice.query.filter_by(token_hash=_token_hash(token)).first()
        if not dev or dev.revoked_at:
            return None
        return dev

    @staticmethod
    def serialize_device(dev: KioskDevice) -> dict:
        return {
            "device_id": dev.device_id,
            "location_id": dev.location_id,
            "location_name": dev.location.loc_name if dev.location else None,
            "name": dev.name,
            "created_at": dev.created_at.isoformat(),
            "last_seen_at": dev.last_seen_at.isoformat() if dev.last_seen_at else None,
        }

    # ── Punch ─────────────────────────────────────────────────────────────────
    def punch(self, dev: KioskDevice, pin: str, action: str = "auto") -> dict:
        now = datetime.utcnow()
        if dev.locked_until and dev.locked_until > now:
            raise KioskLocked("Too many wrong PINs. Try again in a few minutes.")
        dev.last_seen_at = now

        emp = self._identify(dev, pin)
        if not emp:
            dev.failed_attempts = (dev.failed_attempts or 0) + 1
            if dev.failed_attempts >= MAX_FAILS:
                dev.locked_until = now + timedelta(minutes=LOCK_MINUTES)
                dev.failed_attempts = 0
                log.warning("kiosk device %s locked after repeated wrong PINs", dev.device_id)
            db.session.commit()
            raise ValueError(INVALID_PIN)
        dev.failed_attempts = 0
        db.session.commit()

        user = emp.user
        first = ((user.display_name or user.username or "").split() or ["there"])[0] if user else "there"
        if "@" in first:
            first = first.split("@")[0]
        active = time_svc.get_active(emp.user_id)
        on_break = bool(active and any(b.break_end is None for b in active.breaks))

        if action == "auto":
            if not active:
                action = "clock_in"
            elif on_break:
                action = "break_end"
            else:
                # Clocked in: let them choose (break or clock out) without re-checking anything.
                return {"status": "choose", "first_name": first, "options": ["break_start", "clock_out"]}

        tz = tzu.location_tz(dev.location)
        if action == "clock_in":
            shift = self._shift_to_clock_into(emp.user_id, dev.location_id, tz)
            entry = time_svc.clock_in(user_id=emp.user_id, shift_id=shift.shift_id, via_kiosk=True)
            entry.notes = f"Punch-in tablet: {dev.name}"
            db.session.commit()
            done = "clocked_in"
        elif action == "clock_out":
            if not active:
                raise ValueError("You're not clocked in.")
            time_svc.clock_out(user_id=emp.user_id)
            shift = Shift.query.get(active.shift_id) if active.shift_id else None
            done = "clocked_out"
        elif action == "break_start":
            if not active:
                raise ValueError("You're not clocked in.")
            time_svc.start_break(user_id=emp.user_id)
            shift = Shift.query.get(active.shift_id) if active.shift_id else None
            done = "break_started"
        elif action == "break_end":
            time_svc.end_break(user_id=emp.user_id)
            shift = Shift.query.get(active.shift_id) if active and active.shift_id else None
            done = "break_ended"
        else:
            raise ValueError("Unknown action")
        log.info("kiosk device %s: %s for user %s", dev.device_id, done, emp.user_id)
        return {
            "status": done,
            "first_name": first,
            # Only what the person needs; nothing else about them is shown on a shared screen.
            "shift": {
                "start": tzu.format_local_time(shift.start_time, tz),
                "end": tzu.format_local_time(shift.end_time, tz),
            } if shift else None,
        }

    def _identify(self, dev: KioskDevice, pin: str):
        pin = str(pin or "")
        if len(pin) != 4 or not pin.isdigit():
            return None
        loc = dev.location or Location.query.get(dev.location_id)
        if not loc:
            return None
        # Active, at this tablet's location, in this company. Anything else = invalid.
        return Employment.query.filter_by(
            comp_id=loc.comp_id, location_id=dev.location_id, status="active",
            kiosk_pin_hash=pin_hash(loc.comp_id, pin),
        ).first()

    @staticmethod
    def _shift_to_clock_into(user_id, location_id, tz) -> Shift:
        """Their published shift here whose clock-in window is now (or the nearest one
        today, so the clock-in rules can say 'too early' / 'window passed')."""
        now = tzu.utc_now()
        day_start, day_end = tzu.day_bounds(tz, tzu.local_today(tz))
        shifts = (
            Shift.query.join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
            .filter(ShiftAssignment.user_id == user_id, Shift.location_id == location_id,
                    Shift.status == "published",
                    Shift.start_time < day_end + timedelta(hours=1),
                    Shift.end_time > day_start)
            .all()
        )
        if not shifts:
            raise ValueError("You're not scheduled to work here today. Ask your manager.")
        return min(shifts, key=lambda s: abs((tzu.as_aware_utc(s.start_time) - now).total_seconds()))
