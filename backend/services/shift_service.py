# services/shift_service.py
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from sqlalchemy.exc import IntegrityError
from extensions import db
from models import Shift, ShiftAssignment, ShiftBreak, AppUser, Location, Employment, Role, TimeEntry
from services.notification_service import NotificationService
from utils import timezones as tzu
from utils.availability import availability_conflict
from utils.schedule_rules import check_placement
from utils.socket_events import (
    emit_shift_updated, emit_shift_assigned,
    emit_schedule_published, emit_labor_cost_update,
)

notif_svc = NotificationService()


class OutsideAvailability(ValueError):
    """The person isn't available then. Managers may override (allow_outside_availability)."""
    code = "OUTSIDE_AVAILABILITY"


class ScheduleConflict(ValueError):
    """A change would give someone an impossible schedule. Never applied."""
    code = "SCHEDULE_CONFLICT"

    def __init__(self, message, placements=None):
        super().__init__(message)
        self.placements = placements or []


class NeedsAvailabilityOverride(ValueError):
    """Like OutsideAvailability, for changes that touch several people at once."""
    code = "OUTSIDE_AVAILABILITY"

    def __init__(self, message, placements=None):
        super().__init__(message)
        self.placements = placements or []


def _hhmm(value):
    """'09:30' -> (9, 30); raises ValueError."""
    h, m = [int(x) for x in str(value).split(":")[:2]]
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError
    return h, m


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
                     end_time=None, role_id=None, break_minutes=None, notes=None,
                     breaks=None, allow_outside_availability=False):
        """Edit the SCHEDULED shift. Time entries (what was actually worked) are never
        touched here; corrections to those go through TimeEntryService."""
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_manager(caller_user_id, shift.location_id)
        if shift.status == "cancelled":
            raise ValueError("Cannot edit a cancelled shift")
        tz = tzu.location_tz_by_id(shift.location_id)
        old_start, old_end = tzu.as_aware_utc(shift.start_time), tzu.as_aware_utc(shift.end_time)
        new_start = tzu.localize(start_time, tz) if start_time else old_start
        new_end = tzu.localize(end_time, tz) if end_time else old_end
        times_changed = (new_start, new_end) != (old_start, old_end)
        if start_time or end_time:
            self._assert_times(tzu.as_aware_utc(new_start), tzu.as_aware_utc(new_end))
        if times_changed:
            self._assert_not_worked(shift)
        if role_id is not None and not Role.query.filter_by(role_id=role_id, location_id=shift.location_id).first():
            raise ValueError("Role isn't defined at this location")

        if breaks is not None:
            spans = self._parse_breaks(breaks, tz, new_start, new_end, shift.location_id)
        elif times_changed and shift.breaks:
            # Planned breaks move with the shift.
            delta = new_start - old_start
            spans = [(tzu.as_aware_utc(b.start_time) + delta, tzu.as_aware_utc(b.end_time) + delta) for b in shift.breaks]
            if any(bs < new_start or be > new_end for bs, be in spans):
                raise ValueError("A scheduled break would fall outside the new shift times; adjust the breaks too")
        else:
            spans = None
        total_break = (sum((be - bs).total_seconds() for bs, be in spans) // 60) if spans is not None and spans else None
        eff_break = int(total_break) if total_break is not None else (break_minutes if break_minutes is not None else shift.break_minutes)

        warnings = []
        if times_changed or (role_id is not None and role_id != shift.role_id) or eff_break != shift.break_minutes:
            placements = self._check_people(
                [a.user_id for a in shift.assignments], shift.location_id, new_start, new_end,
                eff_break, role_id if role_id is not None else shift.role_id, shift.shift_id,
                allow_outside_availability,
            )
            warnings = [w for p in placements for w in p["warnings"]]

        shift.start_time, shift.end_time = new_start, new_end
        if role_id is not None:       shift.role_id       = role_id
        if notes is not None:         shift.notes         = notes
        if spans is not None:
            shift.breaks = [ShiftBreak(start_time=bs, end_time=be) for bs, be in spans]
            shift.break_minutes = eff_break if spans else (break_minutes if break_minutes is not None else 0)
        elif break_minutes is not None:
            shift.break_minutes = break_minutes
        db.session.commit()
        emit_shift_updated(shift.location_id, shift.shift_id, "updated")
        if times_changed:
            self._notify_changed(shift, {a.user_id for a in shift.assignments})
        shift._warnings = warnings
        return shift

    # ── Move (drag & drop) ────────────────────────────────────────────────────
    def move_shift(self, *, shift_id, caller_user_id, date=None, start=None,
                   from_user_id=None, to_user_id=None, allow_outside_availability=False,
                   dry_run=False):
        """Move a shift to another day, another start time and/or another person, in one
        validated change. Times are location wall-clock:
          date only        same local start/end times on that date (overnight stays overnight)
          start ("HH:MM")  new local start; the shift keeps its wall-clock length
        from/to_user_id   hand the shift from one assignee to another person (or, with no
                          from_user_id, give an open shift to someone).
        Everyone on the shift afterwards is checked against their resulting schedule."""
        shift = Shift.query.get(shift_id)
        if not shift:
            raise ValueError("Shift not found")
        self._assert_manager(caller_user_id, shift.location_id)
        if shift.status == "cancelled":
            raise ValueError("Cannot move a cancelled shift")
        tz = tzu.location_tz_by_id(shift.location_id)
        old_start, old_end = tzu.as_aware_utc(shift.start_time), tzu.as_aware_utc(shift.end_time)
        s_loc, e_loc = tzu.to_local(old_start, tz), tzu.to_local(old_end, tz)

        target = tzu.parse_date(date) if date else s_loc.date()
        if date and not target:
            raise ValueError("date must be YYYY-MM-DD")
        if start:
            try:
                h, m = _hhmm(start)
            except (ValueError, TypeError):
                raise ValueError("start must be HH:MM")
            # Keep the scheduled wall-clock length (8 h stays 8 h on the clock, DST or not).
            span = e_loc.replace(tzinfo=None) - s_loc.replace(tzinfo=None)
            naive_start = datetime.combine(target, datetime.min.time().replace(hour=h, minute=m))
            new_start = tzu.as_aware_utc(naive_start.replace(tzinfo=tz))
            new_end = tzu.as_aware_utc((naive_start + span).replace(tzinfo=tz))
        else:
            new_start = tzu.as_aware_utc(datetime.combine(target, s_loc.time(), tzinfo=tz))
            new_end = tzu.as_aware_utc(datetime.combine(target + (e_loc.date() - s_loc.date()), e_loc.time(), tzinfo=tz))
        self._assert_times(new_start, new_end)
        times_changed = (new_start, new_end) != (old_start, old_end)
        if times_changed:
            self._assert_not_worked(shift)

        current = [a.user_id for a in shift.assignments]
        people = list(current)
        if to_user_id is not None:
            to_user_id = int(to_user_id)
            if from_user_id is not None:
                from_user_id = int(from_user_id)
                if from_user_id not in current:
                    raise ValueError("That person isn't on this shift")
            if to_user_id in current and to_user_id != from_user_id:
                raise ValueError("They're already on this shift")
            people = [u for u in current if u != from_user_id]
            if to_user_id not in people:
                people.append(to_user_id)
        if not times_changed and sorted(people) == sorted(current):
            raise ValueError("Nothing to change: the shift is already there")

        # Only people new to the shift, or everyone if the time moves, need checking.
        to_check = people if times_changed else [u for u in people if u not in current]
        placements = self._check_people(
            to_check, shift.location_id, new_start, new_end, shift.break_minutes, shift.role_id,
            shift.shift_id, allow_outside_availability,
        )
        warnings = [w for p in placements for w in p["warnings"]]
        undo = {
            "date": s_loc.date().isoformat(),
            "start": s_loc.strftime("%H:%M"),
            "from_user_id": to_user_id if to_user_id is not None and to_user_id not in current else None,
            "to_user_id": from_user_id if to_user_id is not None else None,
        }
        if dry_run:
            return {"shift": shift, "warnings": warnings, "placements": placements, "undo": undo, "applied": False}

        delta = new_start - old_start
        for b in shift.breaks:
            b.start_time = tzu.as_aware_utc(b.start_time) + delta
            b.end_time = tzu.as_aware_utc(b.end_time) + delta
        shift.start_time, shift.end_time = new_start, new_end
        removed = set(current) - set(people)
        added = [u for u in people if u not in current]
        for a in list(shift.assignments):
            if a.user_id in removed:
                db.session.delete(a)
        for uid in added:
            db.session.add(ShiftAssignment(shift_id=shift.shift_id, user_id=uid, assigned_by=caller_user_id))
        db.session.commit()
        db.session.refresh(shift)
        import logging
        logging.getLogger("proshifts.audit").info(
            "shift %s moved by user %s: %s→%s, removed=%s added=%s",
            shift.shift_id, caller_user_id, old_start.isoformat(), new_start.isoformat(), sorted(removed), added)
        emit_shift_updated(shift.location_id, shift.shift_id, "updated")
        if shift.status == "published":
            for uid in removed:
                notif_svc.create(user_id=uid, notif_type="shift_unassigned", title="Shift Removed",
                                 body=f"You're no longer on the shift on {tzu.shift_local_str(shift)}.",
                                 data={"shift_id": shift.shift_id})
            for uid in added:
                emit_shift_assigned(uid, shift.shift_id, shift.start_time.isoformat())
                notif_svc.create(user_id=uid, notif_type="shift_assigned", title="New Shift",
                                 body=f"You have been scheduled for {tzu.shift_local_str(shift, '%A, %b %d at %I:%M %p')}.",
                                 data={"shift_id": shift.shift_id})
            if times_changed:
                self._notify_changed(shift, set(people) - set(added))
        return {"shift": shift, "warnings": warnings, "placements": placements, "undo": undo, "applied": True}

    def _check_people(self, user_ids, location_id, start, end, break_minutes, role_id, shift_id,
                      allow_outside_availability):
        """check_placement for each person against their schedule without this shift.
        Raises ScheduleConflict (hard) or NeedsAvailabilityOverride; returns the results."""
        results = [check_placement(user_id=uid, location_id=location_id, start=start, end=end,
                                   break_minutes=break_minutes, role_id=role_id,
                                   ignore_shift_ids=[shift_id]) for uid in user_ids]
        dicts = [p.to_dict() for p in results]
        errors = [e["message"] for p in results for e in p.errors]
        if errors:
            raise ScheduleConflict("; ".join(errors), dicts)
        gaps = [p.availability for p in results if p.availability]
        if gaps and not allow_outside_availability:
            raise NeedsAvailabilityOverride("; ".join(gaps), dicts)
        return dicts

    @staticmethod
    def _assert_not_worked(shift):
        if TimeEntry.query.filter_by(shift_id=shift.shift_id).first():
            raise ValueError("Someone has already clocked in for this shift. Correct their time entry "
                             "instead of moving the scheduled shift.")

    @staticmethod
    def _parse_breaks(breaks, tz, start, end, location_id):
        """[{start_time, end_time}] (naive local ISO or aware) -> sorted aware spans inside the shift."""
        if not isinstance(breaks, list):
            raise ValueError("breaks must be a list")
        spans = []
        for b in breaks:
            try:
                bs = tzu.as_aware_utc(tzu.localize(datetime.fromisoformat(str(b["start_time"])), tz))
                be = tzu.as_aware_utc(tzu.localize(datetime.fromisoformat(str(b["end_time"])), tz))
            except (KeyError, TypeError, ValueError):
                raise ValueError("Each break needs a start_time and end_time")
            if be <= bs:
                raise ValueError("A break must end after it starts")
            if (be - bs) < timedelta(minutes=5):
                raise ValueError("Breaks must be at least 5 minutes")
            if bs < start or be > end:
                raise ValueError("Breaks must be inside the shift")
            spans.append((bs, be))
        spans.sort()
        for (a_s, a_e), (b_s, b_e) in zip(spans, spans[1:]):
            if b_s < a_e:
                raise ValueError("Breaks can't overlap each other")
        loc = Location.query.get(location_id)
        limit = loc.company.max_breaks_per_shift if loc and loc.company else None
        if limit and len(spans) > limit:
            raise ValueError(f"At most {limit} break{'s' if limit != 1 else ''} per shift (your clock-in settings)")
        if spans and sum((e - s).total_seconds() for s, e in spans) >= (end - start).total_seconds():
            raise ValueError("Breaks must be shorter than the shift")
        return spans

    @staticmethod
    def _notify_changed(shift, user_ids):
        if shift.status != "published":
            return
        for uid in user_ids:
            notif_svc.create(user_id=uid, notif_type="shift_updated", title="Shift Changed",
                             body=f"Your shift is now {tzu.shift_local_str(shift, '%A, %b %d at %I:%M %p')}.",
                             data={"shift_id": shift.shift_id})

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
        if ShiftAssignment.query.filter_by(shift_id=shift_id, user_id=user_id).first():
            raise ValueError("User is already assigned to this shift")
        # The same rules as moves and swaps (utils/schedule_rules.py).
        p = check_placement(user_id=user_id, location_id=shift.location_id,
                            start=shift.start_time, end=shift.end_time,
                            break_minutes=shift.break_minutes, role_id=shift.role_id)
        if p.errors:
            raise ValueError(p.errors[0]["message"])
        if p.availability and not allow_outside_availability:
            raise OutsideAvailability(p.availability)
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
        assignment._warnings = [w["message"] for w in p.warnings]
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
                # Planned breaks keep their place in the shift.
                for b in src.breaks:
                    off_s = tzu.as_aware_utc(b.start_time) - tzu.as_aware_utc(src.start_time)
                    off_e = tzu.as_aware_utc(b.end_time) - tzu.as_aware_utc(src.start_time)
                    db.session.add(ShiftBreak(shift_id=shift.shift_id, start_time=tzu.as_aware_utc(start) + off_s,
                                              end_time=tzu.as_aware_utc(start) + off_e))
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

    # ── Week status (for schedule filters) ────────────────────────────────────
    LATE_GRACE = timedelta(minutes=5)

    def week_status(self, *, caller_user_id, location_id, week_start):
        """Per (shift, person) for the week: clock status and scheduling flags.

        clock_status (published shifts only; drafts haven't been worked):
          not_started | working | on_break | ended | late (start passed, not clocked in) |
          missed (shift over, never clocked in). `late_arrival` marks a late clock-in.
        flags: availability (outside their availability), overtime (over the weekly
          threshold or their max hours), conflict (overlaps another of their shifts or
          approved time off). Same rules as assigning (utils/schedule_rules.py).
        """
        self._assert_manager(caller_user_id, location_id)
        day = tzu.parse_date(week_start)
        if not day:
            raise ValueError("week_start must be YYYY-MM-DD")
        ws, we = self._local_week(location_id, day)
        shifts = Shift.query.filter(
            Shift.location_id == location_id, Shift.status != "cancelled",
            Shift.start_time >= ws, Shift.start_time < we,
        ).all()
        user_ids = {a.user_id for s in shifts for a in s.assignments}
        entries = TimeEntry.query.filter(
            TimeEntry.user_id.in_(user_ids or {0}),
            TimeEntry.clock_in >= ws - timedelta(days=1), TimeEntry.clock_in < we + timedelta(days=1),
        ).all() if user_ids else []
        now = tzu.utc_now()
        items = []
        for sh in shifts:
            start, end = tzu.as_aware_utc(sh.start_time), tzu.as_aware_utc(sh.end_time)
            for a in sh.assignments:
                entry = next((e for e in entries if e.user_id == a.user_id and e.shift_id == sh.shift_id), None) or next(
                    (e for e in entries if e.user_id == a.user_id and e.shift_id is None
                     and start - timedelta(minutes=30) <= tzu.as_aware_utc(e.clock_in) < end), None)
                status, late_arrival = None, False
                if sh.status == "published":
                    if entry:
                        late_arrival = tzu.as_aware_utc(entry.clock_in) > start + self.LATE_GRACE
                        if entry.clock_out:
                            status = "ended"
                        elif any(b.break_end is None for b in entry.breaks):
                            status = "on_break"
                        else:
                            status = "working"
                    elif now >= end:
                        status = "missed"
                    elif now > start + self.LATE_GRACE:
                        status = "late"
                    else:
                        status = "not_started"
                p = check_placement(user_id=a.user_id, location_id=location_id, start=start, end=end,
                                    break_minutes=sh.break_minutes, role_id=sh.role_id,
                                    ignore_shift_ids=[sh.shift_id])
                flags = []
                if p.availability:
                    flags.append("availability")
                if any(w["code"] in ("OVERTIME", "OVERTIME_NOT_ELIGIBLE", "MAX_HOURS") for w in p.warnings):
                    flags.append("overtime")
                if any(e["code"] in ("OVERLAP", "TIME_OFF") for e in p.errors):
                    flags.append("conflict")
                items.append({"shift_id": sh.shift_id, "user_id": a.user_id, "clock_status": status,
                              "late_arrival": late_arrival, "flags": flags})
        return items

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
            "role_id":       shift.role_id,
            "location_name": shift.location.loc_name if shift.location else None,
            "timezone":      shift.location.timezone if shift.location else "UTC",
            "breaks": [
                {"break_id": b.break_id, "start_time": b.start_time.isoformat(), "end_time": b.end_time.isoformat(),
                 "minutes": int((b.end_time - b.start_time).total_seconds() // 60)}
                for b in shift.breaks
            ],
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