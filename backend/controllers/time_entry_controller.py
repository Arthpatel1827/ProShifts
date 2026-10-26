# controllers/time_entry_controller.py
from extensions import db
from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity
from services.time_entry_service import TimeEntryService

svc = TimeEntryService()


class TimeEntryController:

    def clock_in(self):
        user_id = int(get_jwt_identity())
        data    = request.get_json(silent=True) or {}
        try:
            entry = svc.clock_in(
                user_id=user_id,
                shift_id=data.get("shift_id"),
                notes=data.get("notes"),
                latitude=data.get("latitude"),
                longitude=data.get("longitude"),
                pin=data.get("pin"),
            )
            return jsonify({"message": "Clocked in", "entry": svc.serialize(entry)}), 201
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def manager_clock_in(self):
        manager_id     = int(get_jwt_identity())
        data           = request.get_json(silent=True) or {}
        target_user_id = data.get("user_id")
        if not target_user_id:
            return jsonify({"error": "user_id is required"}), 400
        try:
            entry = svc.manager_clock_in(
                manager_user_id=manager_id,
                target_user_id=int(target_user_id),
                shift_id=data.get("shift_id"),
                notes=data.get("notes"),
            )
            return jsonify({"message": "Employee clocked in", "entry": svc.serialize(entry)}), 201
        except (PermissionError, ValueError) as e:
            return jsonify({"error": str(e)}), 400

    def manager_clock_out(self):
        manager_id     = int(get_jwt_identity())
        data           = request.get_json(silent=True) or {}
        target_user_id = data.get("user_id")
        if not target_user_id:
            return jsonify({"error": "user_id is required"}), 400
        try:
            entry = svc.manager_clock_out(
                manager_user_id=manager_id,
                target_user_id=int(target_user_id),
            )
            return jsonify({"message": "Employee clocked out", "entry": svc.serialize(entry)}), 200
        except (PermissionError, ValueError) as e:
            return jsonify({"error": str(e)}), 400

    def start_break(self):
        user_id = int(get_jwt_identity())
        try:
            brk = svc.start_break(user_id=user_id)
            return jsonify({
                "message":     "Break started",
                "break_start": brk.break_start.isoformat(),
            }), 200
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def end_break(self):
        user_id = int(get_jwt_identity())
        try:
            brk = svc.end_break(user_id=user_id)
            return jsonify({
                "message":          "Break ended",
                "duration_minutes": brk.duration_minutes,
            }), 200
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def clock_out(self):
        user_id = int(get_jwt_identity())
        data    = request.get_json(silent=True) or {}
        try:
            entry    = svc.clock_out(user_id=user_id, notes=data.get("notes"))
            total_h  = round((entry.total_minutes or 0) / 60, 2)
            return jsonify({
                "message":     f"Clocked out. Total: {total_h}h",
                "entry":       svc.serialize(entry),
                "total_hours": total_h,
            }), 200
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def get_active(self):
        user_id  = int(get_jwt_identity())
        active   = svc.get_active(user_id)
        settings = svc.get_clock_settings(user_id)
        today    = svc.get_today_shift(user_id)
        return jsonify({
            "active":        svc.serialize(active) if active else None,
            "is_clocked_in": active is not None,
            "settings":      settings,
            "today_shift":   today,
        }), 200

    def get_history(self):
        user_id = int(get_jwt_identity())
        limit   = request.args.get("limit", default=30, type=int)
        entries = svc.get_history(user_id, limit=limit)
        summary = svc.get_weekly_summary(user_id)
        return jsonify({
            "entries":        [svc.serialize(e) for e in entries],
            "weekly_summary": summary,
        }), 200

    def get_settings(self):
        user_id  = int(get_jwt_identity())
        settings = svc.get_clock_settings(user_id)
        return jsonify({"settings": settings}), 200

    def update_settings(self):
        manager_id = int(get_jwt_identity())
        data       = request.get_json(silent=True) or {}
        try:
            company = svc.update_clock_settings(
                manager_user_id=manager_id,
                clock_in_method=data.get("clock_in_method"),
                break_duration_mins=data.get("break_duration_mins"),
                max_breaks=data.get("max_breaks_per_shift"),
                paid_break=data.get("paid_break"),
                gps_radius_meters=data.get("gps_radius_meters"),
            )
            return jsonify({
                "message": "Clock settings updated",
                "settings": svc.get_clock_settings(manager_id),
            }), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def generate_pin(self):
        manager_id = int(get_jwt_identity())
        try:
            pin = svc.generate_pin(manager_id)
            return jsonify({
                "message": "New PIN generated",
                "pin":     pin,
                "expires": "24 hours",
            }), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        
    def get_team_status(self):
        from datetime import timezone, timedelta
        from models import Shift, ShiftAssignment, Employment, AppUser, TimeEntry

        user_id     = int(get_jwt_identity())
        location_id = request.args.get("location_id", type=int)

        if not location_id:
            return jsonify({"error": "location_id required"}), 400

        # Only people who work at this location may see who is on shift there.
        from services.rbac_service import location_employment
        if not location_employment(user_id, location_id):
            return jsonify({"error": "Forbidden"}), 403

        from models import Location
        from utils import timezones as tzu

        # "Today" is the location's local calendar day — not UTC midnight to midnight.
        location = Location.query.get(location_id)
        tz       = tzu.location_tz(location)
        now      = tzu.utc_now()
        today    = tzu.local_today(tz)
        start, end = tzu.day_bounds(tz, today)

        # All active employees at this location
        emps = Employment.query.filter_by(
            location_id=location_id,
            status="active",
        ).all()

        team_status = []

        for emp in emps:
            if not emp.user:
                continue

            user = emp.user

            # Today's shifts: those starting on the local date, plus an overnight shift
            # from yesterday that is still running (e.g. 11 PM → 3 AM, checked at 1 AM).
            candidates = (
                Shift.query
                .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
                .filter(
                    ShiftAssignment.user_id == user.user_id,
                    Shift.location_id       == location_id,
                    Shift.status            == "published",
                    Shift.start_time        <  end,
                    db.or_(Shift.start_time >= start, Shift.end_time > now),
                )
                .order_by(Shift.start_time.asc())
                .all()
            )
            # Prefer the shift in progress, then the next one today, then the last one.
            today_shift = (
                next((s for s in candidates if tzu.as_aware_utc(s.start_time) <= now < tzu.as_aware_utc(s.end_time)), None)
                or next((s for s in candidates if tzu.as_aware_utc(s.start_time) > now), None)
                or (candidates[-1] if candidates else None)
            )

            # ✅ Only include employees with a shift today
            if not today_shift:
                continue

            # Find active time entry
            active_entry = TimeEntry.query.filter_by(
                user_id=user.user_id,
                clock_out=None,
            ).first()

            # Determine status
            if active_entry:
                is_on_break = any(b.break_end is None for b in active_entry.breaks)
                status      = "on_break" if is_on_break else "working"
            else:
                shift_start = today_shift.start_time
                if shift_start.tzinfo is None:
                    shift_start = shift_start.replace(tzinfo=timezone.utc)
                status = "late" if now > shift_start + timedelta(minutes=15) else "scheduled"

            name     = user.display_name or user.username
            initials = "".join(p[0] for p in name.strip().split()[:2]).upper()

            team_status.append({
                "user_id":     user.user_id,
                "name":        name,
                "initials":    initials,
                "role":        emp.role.name if emp.role else "Staff",
                "status":      status,
                "shift_start": today_shift.start_time.isoformat() if today_shift else None,
                "shift_end":   today_shift.end_time.isoformat()   if today_shift else None,
                "clocked_in":  active_entry.clock_in.isoformat()  if active_entry else None,
            })

        # Sort: late first, then working, on_break, scheduled
        ORDER = {"late": 0, "working": 1, "on_break": 2, "scheduled": 3}
        team_status.sort(key=lambda x: ORDER.get(x["status"], 4))

        # date/timezone tell clients which local day "today" refers to.
        return jsonify({"team": team_status, "date": today.isoformat(), "timezone": tz.key}), 200