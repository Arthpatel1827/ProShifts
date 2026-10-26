# services/shift_service.py
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.exc import IntegrityError
from extensions import db
from models import Shift, ShiftAssignment, AppUser, Location, Employment, Role
from services.notification_service import NotificationService
from utils import timezones as tzu
from utils.availability import availability_conflict
from utils.socket_events import (
    emit_shift_updated, emit_shift_assigned,
    emit_schedule_published, emit_labor_cost_update,
)

notif_svc = NotificationService()


class OutsideAvailability(ValueError):
    """The person isn't available then. Managers may override (allow_outside_availability)."""
    code = "OUTSIDE_AVAILABILITY"


class ShiftService:

    # ── Create ────────────────────────────────────────────────────────────────
    def create_shift(self, *, caller_user_id, location_id, start_time,
                     end_time, role_id=None, break_minutes=0,
                     notes=None, created_by_ai=False):
        self._assert_manager(caller_user_id, location_id)
        # A naive time from a client is wall-clock time at this location.
        tz = tzu.location_tz_by_id(location_id)
        start_time = tzu.localize(start_time, tz)
        end_time   = tzu.localize(end_time, tz)
        self._assert_times(start_time, end_time)

        shift = Shift(
            location_id=location_id,
            role_id=role_id,
            start_time=start_time,
            end_time=end_time,
            break_minutes=break_minutes,
            notes=notes,
            status="draft",
            created_by_ai=created_by_ai,
            created_by=caller_user_id if not created_by_ai else None,
        )
        db.session.add(shift)
        db.session.commit()
        emit_shift_updated(location_id, shift.shift_id, "created")
        return shift

    # ── Read ──────────────────────────────────────────────────────────────────
    def get_shifts(self, *, caller_user_id, location_id,
                   week_start=None, status=None):
        self._assert_member(caller_user_id, location_id)
        q = Shift.query.filter_by(location_id=location_id)
        day = tzu.parse_date(week_start)
        if day:
            # The 7 local days from week_start, in the location's timezone.
            ws, we = self._local_week(location_id, day)
            q = q.filter(Shift.start_time >= ws, Shift.start_time < we)
        if status:
            q = q.filter_by(status=status)
        return q.order_by(Shift.start_time.asc()).all()

    def get_shift(self, shift_id: int, caller_user_id: int):
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_member(caller_user_id, shift.location_id)
        return shift

    def get_my_shifts(self, user_id: int, week_start=None):
        q = (
            db.session.query(Shift)
            .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
            .filter(ShiftAssignment.user_id == user_id, Shift.status == "published")
        )
        day = tzu.parse_date(week_start)
        if day:
            tz = tzu.user_tz(user_id)
            ws, _ = tzu.day_bounds(tz, day)
            we, _ = tzu.day_bounds(tz, day + timedelta(days=7))
            q = q.filter(Shift.start_time >= ws, Shift.start_time < we)
        return q.order_by(Shift.start_time.asc()).all()

    # ── Update ────────────────────────────────────────────────────────────────
    def update_shift(self, *, shift_id, caller_user_id, start_time=None,
                     end_time=None, role_id=None, break_minutes=None, notes=None):
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_manager(caller_user_id, shift.location_id)
        if shift.status == "cancelled":
            raise ValueError("Cannot edit a cancelled shift")
        tz = tzu.location_tz_by_id(shift.location_id)
        if start_time:    shift.start_time    = tzu.localize(start_time, tz)
        if end_time:      shift.end_time      = tzu.localize(end_time, tz)
        if role_id is not None:       shift.role_id       = role_id
        if break_minutes is not None: shift.break_minutes = break_minutes
        if notes is not None:         shift.notes         = notes
        if start_time or end_time:
            self._assert_times(tzu.as_aware_utc(shift.start_time), tzu.as_aware_utc(shift.end_time))
        db.session.commit()
        emit_shift_updated(shift.location_id, shift.shift_id, "updated")
        return shift

    # ── Cancel ────────────────────────────────────────────────────────────────
    def cancel_shift(self, *, shift_id, caller_user_id):
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_manager(caller_user_id, shift.location_id)
        shift.status = "cancelled"
        db.session.commit()
        for assignment in shift.assignments:
            notif_svc.create(
                user_id=assignment.user_id,
                notif_type="shift_cancelled",
                title="Shift Cancelled",
                body=f"Your shift on {tzu.shift_local_str(shift)} has been cancelled.",
                data={"shift_id": shift_id},
            )
        emit_shift_updated(shift.location_id, shift.shift_id, "cancelled")
        return shift

    # ── Assign ────────────────────────────────────────────────────────────────
    def assign_user(self, *, shift_id, user_id, caller_user_id, allow_outside_availability=False):
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_manager(caller_user_id, shift.location_id)
        if shift.status == "cancelled":
            raise ValueError("Cannot assign staff to a cancelled shift")
        emp = Employment.query.filter_by(
            user_id=user_id, location_id=shift.location_id, status="active"
        ).first()
        if not emp:
            raise ValueError("User is not an active employee at this location")
        if ShiftAssignment.query.filter_by(shift_id=shift_id, user_id=user_id).first():
            raise ValueError("User is already assigned to this shift")
        # Same conflict rules as bulk_create_week.
        if self._has_overlap(user_id, shift.start_time, shift.end_time):
            raise ValueError("This employee already has a shift that overlaps this time")
        # Time off is stored as local calendar dates, so compare the shift's *local* date.
        day = tzu.local_date_of(shift.start_time, tzu.location_tz_by_id(shift.location_id))
        time_off = self._approved_timeoff_map(shift.location_id, day, day + timedelta(days=1))
        if self._is_on_timeoff(time_off, user_id, day):
            raise ValueError("This employee has approved time off on this day")
        if not allow_outside_availability:
            conflict = availability_conflict(user_id, shift.location_id, shift.start_time, shift.end_time)
            if conflict:
                raise OutsideAvailability(conflict)
        assignment = ShiftAssignment(
            shift_id=shift_id, user_id=user_id, assigned_by=caller_user_id
        )
        db.session.add(assignment)
        db.session.commit()
        emit_shift_assigned(user_id, shift_id, shift.start_time.isoformat())
        notif_svc.create(
            user_id=user_id,
            notif_type="shift_assigned",
            title="New Shift",
            body=f"You have been scheduled for {tzu.shift_local_str(shift, '%A, %b %d at %I:%M %p')}.",
            data={"shift_id": shift_id},
        )
        return assignment

    def unassign_user(self, *, shift_id, user_id, caller_user_id):
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_manager(caller_user_id, shift.location_id)
        assignment = ShiftAssignment.query.filter_by(
            shift_id=shift_id, user_id=user_id
        ).first()
        if not assignment:
            raise ValueError("Assignment not found")
        db.session.delete(assignment)
        db.session.commit()
        emit_shift_updated(shift.location_id, shift_id, "unassigned")
        return True

    # ── Bulk week-wise create ─────────────────────────────────────────────────
    def bulk_create_week(self, *, caller_user_id, location_id, week_start, rows, allow_outside_availability=False):
        """
        Create shifts across a week from role-grouped rows.

        rows: list of dicts, each:
          {
            "role_id":     int | None,
            "user_id":     int,
            "start_time":  "HH:MM",
            "end_time":    "HH:MM",
            "days":        [0..6]   # 0=Monday ... 6=Sunday
            "break_minutes": int (optional)
          }
        """
        self._assert_manager(caller_user_id, location_id)

        day = tzu.parse_date(week_start)
        if not day:
            raise ValueError("week_start must be YYYY-MM-DD")
        # Row times ("09:00") are wall-clock times at this location.
        tz = tzu.location_tz_by_id(location_id)
        monday = tzu.week_monday(day)
        time_off_map = self._approved_timeoff_map(location_id, monday, monday + timedelta(days=7))

        created = []
        skipped = []

        for idx, row in enumerate(rows):
            try:
                user_id  = int(row["user_id"])
                days     = row.get("days", [])
                st_str   = row["start_time"]
                et_str   = row["end_time"]
                role_id  = row.get("role_id")
                brk      = int(row.get("break_minutes", 0))
            except (KeyError, ValueError, TypeError):
                skipped.append({"index": idx, "reason": "Missing or invalid fields"})
                continue

            if not days:
                skipped.append({"index": idx, "reason": "No days selected"})
                continue

            emp = Employment.query.filter_by(
                user_id=user_id, location_id=location_id, status="active"
            ).first()
            if not emp:
                skipped.append({"index": idx, "reason": "Employee not active at this location"})
                continue
            if role_id is not None and not Role.query.filter_by(role_id=role_id, location_id=location_id).first():
                skipped.append({"index": idx, "reason": "Role isn't defined at this location"})
                continue

            try:
                sh, sm = [int(x) for x in st_str.split(":")]
                eh, em = [int(x) for x in et_str.split(":")]
            except (ValueError, AttributeError):
                skipped.append({"index": idx, "reason": "Invalid time format"})
                continue

            for day in days:
                if day < 0 or day > 6:
                    continue
                day_date = monday + timedelta(days=day)
                try:
                    start_time = datetime.combine(day_date, datetime.min.time().replace(hour=sh, minute=sm), tzinfo=tz)
                    # Overnight shift support: an end at or before the start is on the next day.
                    end_date = day_date + timedelta(days=1) if (eh, em) <= (sh, sm) else day_date
                    end_time = datetime.combine(end_date, datetime.min.time().replace(hour=eh, minute=em), tzinfo=tz)
                except ValueError:
                    skipped.append({"index": idx, "reason": "Invalid time format"})
                    break

                # Conflict: approved time off
                if self._is_on_timeoff(time_off_map, user_id, day_date):
                    skipped.append({
                        "index": idx, "user_id": user_id,
                        "day": day_date.strftime("%a %b %d"),
                        "reason": "Employee has approved time off",
                    })
                    continue

                # Conflict: overlapping existing shift for this employee
                if self._has_overlap(user_id, start_time, end_time):
                    skipped.append({
                        "index": idx, "user_id": user_id,
                        "day": day_date.strftime("%a %b %d"),
                        "reason": "Overlaps an existing shift",
                    })
                    continue

                # Conflict: outside their availability (unless the manager chose to include them)
                if not allow_outside_availability:
                    conflict = availability_conflict(user_id, location_id, start_time, end_time)
                    if conflict:
                        skipped.append({
                            "index": idx, "user_id": user_id,
                            "day": day_date.strftime("%a %b %d"),
                            "reason": conflict,
                            "code": OutsideAvailability.code,
                        })
                        continue

                shift = Shift(
                    location_id=location_id,
                    role_id=role_id,
                    start_time=start_time,
                    end_time=end_time,
                    break_minutes=brk,
                    status="draft",
                    created_by=caller_user_id,
                )
                db.session.add(shift)
                db.session.flush()  # get shift_id

                db.session.add(ShiftAssignment(
                    shift_id=shift.shift_id,
                    user_id=user_id,
                    assigned_by=caller_user_id,
                ))
                created.append(shift.shift_id)

        db.session.commit()

        return {
            "created_count": len(created),
            "created_ids":   created,
            "skipped":       skipped,
        }

    # ── Copy / paste ──────────────────────────────────────────────────────────
    MAX_COPY = 500

    def copy_shifts(self, *, caller_user_id, location_id, items, include_assignees=True, allow_outside_availability=False):
        """
        Copy existing shifts to other dates as DRAFTS.

        items: [{"shift_id": int, "date": "YYYY-MM-DD"}, ...] — each source shift is placed
        on that local date at the same wall-clock times (overnight shifts stay overnight,
        and DST is respected). Assigned staff are carried over only when they still pass
        the same checks as assign_user (active here, no overlap, no approved time off);
        otherwise the copied shift stays open and the reason is reported.
        A shift already on the target date with the same times, role AND people is
        skipped, so copying twice doesn't double the schedule; an open shift in the same
        slot is filled with the copied staff instead of getting a second shift beside it.
        """
        self._assert_manager(caller_user_id, location_id)
        if not isinstance(items, list) or not items:
            raise ValueError("items must be a non-empty list")
        if len(items) > self.MAX_COPY:
            raise ValueError(f"Copy at most {self.MAX_COPY} shifts at once")

        tz = tzu.location_tz_by_id(location_id)
        active = {
            e.user_id: e for e in Employment.query.filter_by(location_id=location_id, status="active").all()
        }
        sources = {}
        created, filled, skipped, unassigned = [], [], [], []
        used_open = set()

        for idx, item in enumerate(items):
            try:
                sid = int(item["shift_id"])
            except (KeyError, TypeError, ValueError):
                skipped.append({"index": idx, "reason": "Missing or invalid shift_id"})
                continue
            target = tzu.parse_date((item or {}).get("date"))
            if not target:
                skipped.append({"index": idx, "shift_id": sid, "reason": "date must be YYYY-MM-DD"})
                continue
            if sid not in sources:
                sources[sid] = Shift.query.get(sid)
            src = sources[sid]
            if not src or src.location_id != location_id or src.status == "cancelled":
                skipped.append({"index": idx, "shift_id": sid, "reason": "Shift not found at this location"})
                continue

            s_local = tzu.to_local(src.start_time, tz)
            e_local = tzu.to_local(src.end_time, tz)
            start = datetime.combine(target, s_local.time(), tzinfo=tz)
            end = datetime.combine(target + (e_local.date() - s_local.date()), e_local.time(), tzinfo=tz)
            label = target.strftime("%a %b %d")

            # Shifts already in that exact slot (same times and role).
            same_slot = Shift.query.filter(
                Shift.location_id == location_id,
                Shift.status.in_(["draft", "published"]),
                Shift.start_time == start, Shift.end_time == end,
                Shift.role_id == src.role_id if src.role_id is not None else Shift.role_id.is_(None),
            ).all()
            wanted = {a.user_id for a in src.assignments} if include_assignees else set()
            # Same slot AND same people: it's already there (copying twice changes nothing).
            # Several people on identical slots are separate shifts, so people are compared too.
            if any({a.user_id for a in e.assignments} == wanted for e in same_slot):
                skipped.append({"index": idx, "shift_id": sid, "date": target.isoformat(),
                                "reason": f"An identical shift is already on {label}"})
                continue

            # An open shift in that slot gets the staff instead of a second copy beside it.
            open_slot = next((e for e in same_slot if not e.assignments and e.shift_id not in used_open), None) if wanted else None
            if open_slot is not None:
                shift = open_slot
                used_open.add(shift.shift_id)
            else:
                shift = Shift(
                    location_id=location_id, role_id=src.role_id,
                    start_time=start, end_time=end,
                    break_minutes=src.break_minutes or 0, notes=src.notes,
                    status="draft", created_by=caller_user_id,
                )
                db.session.add(shift)
                db.session.flush()
                created.append(shift.shift_id)

            if not include_assignees:
                continue
            time_off = self._approved_timeoff_map(location_id, target, target + timedelta(days=1))
            for a in src.assignments:
                emp = active.get(a.user_id)
                name = (emp.user.display_name or emp.user.username) if emp and emp.user else None
                reason = None
                if not emp:
                    reason = "No longer an active employee here"
                elif self._is_on_timeoff(time_off, a.user_id, target):
                    reason = "Has approved time off"
                elif self._has_overlap(a.user_id, start, end):
                    reason = "Already has a shift that overlaps"
                elif not allow_outside_availability:
                    reason = availability_conflict(a.user_id, location_id, start, end)
                if reason:
                    unassigned.append({"shift_id": shift.shift_id, "user_id": a.user_id, "name": name,
                                       "date": target.isoformat(), "reason": reason})
                    continue
                db.session.add(ShiftAssignment(shift_id=shift.shift_id, user_id=a.user_id, assigned_by=caller_user_id))
                db.session.flush()
                if open_slot is not None and shift.shift_id not in filled:
                    filled.append(shift.shift_id)

        db.session.commit()
        if created or filled:
            emit_shift_updated(location_id, (created or filled)[-1], "created")
        return {
            "created_count": len(created),
            "created_ids": created,
            # Existing open shifts in the same slot that received the copied staff.
            "filled_count": len(filled),
            "filled_ids": filled,
            "skipped": skipped,
            "unassigned": unassigned,
        }

    def _approved_timeoff_map(self, location_id, start, end):
        """{user_id: [(start_date, end_date), ...]} for approved time off overlapping the
        local calendar dates [start, end)."""
        try:
            from models import TimeOffRequest
        except ImportError:
            return {}
        reqs = TimeOffRequest.query.filter(
            TimeOffRequest.status == "approved",
            TimeOffRequest.start_date < end,
            TimeOffRequest.end_date >= start,
        ).all()
        result = {}
        for r in reqs:
            result.setdefault(r.user_id, []).append((r.start_date, r.end_date))
        return result

    @staticmethod
    def _is_on_timeoff(time_off_map, user_id, day_date):
        for (s, e) in time_off_map.get(user_id, []):
            if s <= day_date <= e:
                return True
        return False

    @staticmethod
    def _has_overlap(user_id, start_time, end_time):
        existing = (
            db.session.query(Shift)
            .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
            .filter(
                ShiftAssignment.user_id == user_id,
                Shift.status.in_(["draft", "published"]),
                Shift.start_time < end_time,
                Shift.end_time > start_time,
            )
            .first()
        )
        return existing is not None

    # ── Roles with assignable staff (for week-wise UI) ────────────────────────
    def roles_with_staff(self, *, caller_user_id, location_id):
        self._assert_member(caller_user_id, location_id)

        roles = Role.query.filter_by(location_id=location_id).order_by(Role.name.asc()).all()
        emps  = Employment.query.filter_by(location_id=location_id, status="active").all()

        by_role = {}
        for e in emps:
            if not e.user:
                continue
            by_role.setdefault(e.role_id, []).append({
                "user_id": e.user.user_id,
                "name":    e.user.display_name or e.user.username,
                "role":    e.role.name if e.role else None,
            })

        result = []
        for role in roles:
            result.append({
                "role_id":   role.role_id,
                "role_name": role.name,
                "employees": by_role.get(role.role_id, []),
            })

        no_role = by_role.get(None, [])
        if no_role:
            result.append({
                "role_id":   None,
                "role_name": "Unassigned",
                "employees": no_role,
            })

        return result

    # ── Publish ───────────────────────────────────────────────────────────────
    def publish_week(self, *, caller_user_id, location_id, week_start):
        self._assert_manager(caller_user_id, location_id)
        day = tzu.parse_date(week_start)
        if not day:
            raise ValueError("week_start must be YYYY-MM-DD")
        ws, we = self._local_week(location_id, day)
        drafts = Shift.query.filter(
            Shift.location_id == location_id,
            Shift.status == "draft",
            Shift.start_time >= ws,
            Shift.start_time < we,
        ).all()
        if not drafts:
            raise ValueError("No draft shifts found for this week")
        now = datetime.utcnow()
        for shift in drafts:
            shift.status       = "published"
            shift.published_at = now
        db.session.commit()
        count = len(drafts)
        emit_schedule_published(location_id, week_start, count)
        notif_svc.notify_location_staff(
            location_id=location_id,
            notif_type="schedule_published",
            title="Schedule Published",
            body=f"The schedule for week of {day.strftime('%b %d')} is now available.",
            data={"week_start": week_start, "location_id": location_id},
        )
        return count

    # ── Labor cost ────────────────────────────────────────────────────────────
    def get_labor_cost(self, *, location_id, week_start, hourly_rate=15.0):
        day = tzu.parse_date(week_start)
        if not day:
            raise ValueError("week_start must be YYYY-MM-DD")
        ws, we = self._local_week(location_id, day)
        shifts = Shift.query.filter(
            Shift.location_id == location_id,
            Shift.status.in_(["draft", "published"]),
            Shift.start_time >= ws,
            Shift.start_time < we,
        ).all()
        # Cost each assignment at that employee's own rate. Unassigned shifts and
        # employees without a rate fall back to `hourly_rate` so the estimate isn't zero.
        rates = {
            e.user_id: float(e.hourly_rate)
            for e in Employment.query.filter_by(location_id=location_id, status="active").all()
            if e.hourly_rate is not None
        }
        total_minutes = 0.0
        total_cost    = 0.0
        unassigned_minutes = 0.0
        for shift in shifts:
            duration = (shift.end_time - shift.start_time).total_seconds() / 60
            paid = max(duration - (shift.break_minutes or 0), 0)
            total_minutes += paid
            if shift.assignments:
                for a in shift.assignments:
                    total_cost += paid / 60 * rates.get(a.user_id, hourly_rate)
            else:
                unassigned_minutes += paid
                total_cost += paid / 60 * hourly_rate
        return {
            "location_id":      location_id,
            "week_start":       week_start,
            "total_shifts":     len(shifts),
            "total_hours":      round(total_minutes / 60, 2),
            "total_cost":       round(total_cost, 2),
            "hourly_rate":      hourly_rate,
            "unassigned_hours": round(unassigned_minutes / 60, 2),
        }

    # ── Serialize ─────────────────────────────────────────────────────────────
    @staticmethod
    def serialize(shift: Shift) -> dict:
        return {
            "shift_id":      shift.shift_id,
            "location_id":   shift.location_id,
            "role":          shift.role.name if shift.role else None,
            "start_time":    shift.start_time.isoformat(),
            "end_time":      shift.end_time.isoformat(),
            "break_minutes": shift.break_minutes,
            "notes":         shift.notes,
            "status":        shift.status,
            "created_by_ai": shift.created_by_ai,
            "published_at":  shift.published_at.isoformat() if shift.published_at else None,
            "assignments": [
                {"user_id": a.user_id, "assigned_at": a.assigned_at.isoformat()}
                for a in shift.assignments
            ],
        }

    @staticmethod
    def _local_week(location_id, first_day):
        """Aware UTC bounds of the 7 local days starting at first_day at this location."""
        tz = tzu.location_tz_by_id(location_id)
        start, _ = tzu.day_bounds(tz, first_day)
        end, _ = tzu.day_bounds(tz, first_day + timedelta(days=7))
        return start, end

    # ── Guards ────────────────────────────────────────────────────────────────
    @staticmethod
    def _assert_manager(user_id, location_id):
        emp = Employment.query.filter_by(
            user_id=user_id, location_id=location_id, status="active"
        ).first()
        if not emp:
            raise PermissionError("Not an employee at this location")
        if (emp.role.name if emp.role else "").lower() not in ("owner", "manager", "supervisor"):
            raise PermissionError("Manager or above required")

    @staticmethod
    def _assert_member(user_id, location_id):
        if not Employment.query.filter_by(
            user_id=user_id, location_id=location_id, status="active"
        ).first():
            raise PermissionError("Not an employee at this location")

    @staticmethod
    def _assert_times(start, end):
        if start >= end:
            raise ValueError("start_time must be before end_time")