# services/swap_service.py
from datetime import datetime
from extensions import db
from models import ShiftSwap, ShiftAssignment, Shift, Employment, AppUser
from services.notification_service import NotificationService
from utils import timezones as tzu
from utils.schedule_rules import check_placement

notif_svc = NotificationService()


class SwapConflict(ValueError):
    """The swap would leave someone with an impossible schedule (overlap, time off,
    not active). Never applied, whoever asks — including a manager approving it."""
    code = "SWAP_CONFLICT"

    def __init__(self, message, validation):
        super().__init__(message)
        self.validation = validation


class SwapNeedsOverride(ValueError):
    """Only availability is in the way: a manager may approve anyway (as when assigning)."""
    code = "OUTSIDE_AVAILABILITY"

    def __init__(self, message, validation):
        super().__init__(message)
        self.validation = validation


class SwapService:

    # ── Open swap — post to marketplace ───────────────────────────────────────
    def request_open(self, *, requesting_user_id: int, shift_id: int, reason: str = None) -> ShiftSwap:
        self._assert_assigned(shift_id, requesting_user_id)
        self._assert_shift_available(shift_id)
        self._assert_no_pending(shift_id, requesting_user_id)

        swap = ShiftSwap(
            shift_id=shift_id,
            requesting_user_id=requesting_user_id,
            swap_type="open",
            reason=reason,
            status="pending",
        )
        db.session.add(swap)
        db.session.commit()
        self._notify_location_staff(swap)
        return swap

    # ── Targeted swap — pick colleague + their shift ───────────────────────────
    def request_targeted(
        self, *,
        requesting_user_id: int,
        shift_id:           int,
        receiving_user_id:  int,
        offered_shift_id:   int,
        reason:             str = None,
    ) -> ShiftSwap:
        if requesting_user_id == receiving_user_id:
            raise ValueError("You cannot swap with yourself.")
        self._assert_assigned(shift_id, requesting_user_id)
        # Location/tenant check before anything about the other person's shift is revealed.
        self._assert_same_location_staff(shift_id, offered_shift_id, requesting_user_id, receiving_user_id)
        self._assert_assigned(offered_shift_id, receiving_user_id)
        self._assert_shift_available(shift_id)
        self._assert_shift_available(offered_shift_id)
        self._assert_no_pending(shift_id, requesting_user_id)
        self._raise_if_conflict(self.evaluate(
            shift_id=shift_id, requesting_user_id=requesting_user_id,
            offered_shift_id=offered_shift_id, receiving_user_id=receiving_user_id,
        ))

        swap = ShiftSwap(
            shift_id=shift_id,
            requesting_user_id=requesting_user_id,
            receiving_user_id=receiving_user_id,
            offered_shift_id=offered_shift_id,
            swap_type="targeted",
            reason=reason,
            status="pending",
        )
        db.session.add(swap)
        db.session.commit()

        # Notify the receiver
        requester = AppUser.query.get(requesting_user_id)
        shift     = Shift.query.get(shift_id)
        notif_svc.create(
            user_id=receiving_user_id,
            notif_type="swap_requested",
            title="Swap Request Received",
            body=(
                f"{requester.display_name or requester.username} wants to swap their shift on "
                f"{tzu.shift_local_str(shift)} with one of yours."
            ),
            data={"swap_id": swap.swap_id},
        )
        return swap

    # ── Make offer on open swap ───────────────────────────────────────────────
    def make_offer(self, *, user_id: int, swap_id: int, offered_shift_id: int) -> ShiftSwap:
        swap = self._get(swap_id)
        if swap.swap_type != "open":
            raise ValueError("This is a targeted swap — offers are not accepted.")
        if swap.requesting_user_id == user_id:
            raise ValueError("You cannot offer on your own swap.")
        if swap.status != "pending":
            raise ValueError("This swap is no longer open for offers.")

        self._assert_assigned(offered_shift_id, user_id)
        self._assert_shift_available(offered_shift_id)
        self._assert_same_location_staff(swap.shift_id, offered_shift_id, swap.requesting_user_id, user_id)
        self._raise_if_conflict(self.evaluate(
            shift_id=swap.shift_id, requesting_user_id=swap.requesting_user_id,
            offered_shift_id=offered_shift_id, receiving_user_id=user_id,
        ))

        swap.receiving_user_id = user_id
        swap.offered_shift_id  = offered_shift_id
        swap.status            = "offer_pending"
        db.session.commit()

        # Notify requester
        offerer       = AppUser.query.get(user_id)
        offered_shift = Shift.query.get(offered_shift_id)
        notif_svc.create(
            user_id=swap.requesting_user_id,
            notif_type="swap_offer",
            title="Someone Offered a Swap",
            body=(
                f"{offerer.display_name or offerer.username} offered their shift on "
                f"{tzu.shift_local_str(offered_shift)} in exchange."
            ),
            data={"swap_id": swap_id},
        )
        return swap

    # ── Retract offer (back to open) ──────────────────────────────────────────
    def retract_offer(self, *, user_id: int, swap_id: int) -> ShiftSwap:
        swap = self._get(swap_id)
        if swap.receiving_user_id != user_id:
            raise PermissionError("You did not make this offer.")
        if swap.status != "offer_pending":
            raise ValueError("No active offer to retract.")
        swap.receiving_user_id = None
        swap.offered_shift_id  = None
        swap.status            = "pending"
        db.session.commit()
        return swap

    # ── Accept (open: requester accepts offer | targeted: receiver agrees) ────
    def accept(self, *, user_id: int, swap_id: int) -> ShiftSwap:
        swap = self._get(swap_id)

        if swap.swap_type == "open":
            # Requester must accept the offer
            if swap.requesting_user_id != user_id:
                raise PermissionError("Only the requester can accept an offer.")
            if swap.status != "offer_pending":
                raise ValueError("No pending offer to accept.")
        else:
            # Targeted: receiver accepts
            if swap.receiving_user_id != user_id:
                raise PermissionError("Only the intended receiver can accept.")
            if swap.status != "pending":
                raise ValueError("Swap is no longer pending.")

        # The schedule may have changed since the request: check the result again.
        self._raise_if_conflict(self.evaluate_swap(swap))

        swap.status = "accepted"
        db.session.commit()

        # Notify the other party
        other_id = swap.receiving_user_id if swap.requesting_user_id == user_id else swap.requesting_user_id
        accepter = AppUser.query.get(user_id)
        notif_svc.create(
            user_id=other_id,
            notif_type="swap_accepted",
            title="Swap Accepted",
            body=f"{accepter.display_name or accepter.username} accepted the swap. Waiting for manager approval.",
            data={"swap_id": swap_id},
        )
        # Notify managers
        shift = Shift.query.get(swap.shift_id)
        self._notify_managers_approval(swap, shift)
        return swap

    # ── Reject ────────────────────────────────────────────────────────────────
    def reject(self, *, user_id: int, swap_id: int) -> ShiftSwap:
        swap = self._get(swap_id)

        if swap.swap_type == "targeted" and swap.receiving_user_id == user_id:
            pass  # receiver rejects targeted swap
        elif swap.swap_type == "open" and swap.requesting_user_id == user_id and swap.status == "offer_pending":
            # Requester rejects the offer — back to open
            swap.receiving_user_id = None
            swap.offered_shift_id  = None
            swap.status            = "pending"
            db.session.commit()
            return swap
        else:
            raise PermissionError("Not authorized to reject this swap.")

        swap.status = "rejected"
        db.session.commit()

        notif_svc.create(
            user_id=swap.requesting_user_id,
            notif_type="swap_rejected",
            title="Swap Declined",
            body="Your swap request was declined.",
            data={"swap_id": swap_id},
        )
        return swap

    # ── Cancel (requester cancels) ────────────────────────────────────────────
    def cancel(self, *, user_id: int, swap_id: int) -> ShiftSwap:
        swap = self._get(swap_id)
        if swap.requesting_user_id != user_id:
            raise PermissionError("Only the requester can cancel.")
        if swap.status in ("approved", "rejected", "cancelled"):
            raise ValueError("Cannot cancel at this stage.")
        swap.status = "cancelled"
        db.session.commit()
        return swap

    # ── Manager approve/reject ────────────────────────────────────────────────
    def manager_decide(self, *, swap_id: int, manager_user_id: int, approve: bool,
                       allow_outside_availability: bool = False) -> dict:
        swap = self._get(swap_id)
        if swap.status != "accepted":
            raise ValueError("Swap must be accepted by both parties first.")

        shift = Shift.query.get(swap.shift_id)
        self._assert_manager(manager_user_id, shift.location_id)

        validation = None
        if approve:
            # Never trust the check made when the swap was requested: the schedule may
            # have changed since. Recalculate the resulting schedule now.
            validation = self.evaluate_swap(swap)
            self._raise_if_conflict(validation)
            if validation["needs_override"] and not allow_outside_availability:
                raise SwapNeedsOverride(
                    "; ".join(validation["availability"]) + ". Approve anyway?", validation
                )

            req_assignment = ShiftAssignment.query.filter_by(
                shift_id=swap.shift_id, user_id=swap.requesting_user_id
            ).first()
            rec_assignment = ShiftAssignment.query.filter_by(
                shift_id=swap.offered_shift_id, user_id=swap.receiving_user_id
            ).first() if swap.offered_shift_id else None
            now = datetime.utcnow()
            # Swap requester's shift → receiver; receiver's shift → requester.
            req_assignment.user_id, req_assignment.assigned_by, req_assignment.assigned_at = (
                swap.receiving_user_id, manager_user_id, now)
            if rec_assignment:
                rec_assignment.user_id, rec_assignment.assigned_by, rec_assignment.assigned_at = (
                    swap.requesting_user_id, manager_user_id, now)

            swap.status           = "approved"
            swap.manager_approved = True
        else:
            swap.status           = "rejected"
            swap.manager_approved = False

        db.session.commit()
        import logging
        logging.getLogger("proshifts.audit").info(
            "swap %s %s by user %s", swap_id, "approved" if approve else "rejected", manager_user_id)

        # Notify both parties
        status_word = "approved" if approve else "rejected"
        for uid in [swap.requesting_user_id, swap.receiving_user_id]:
            if uid:
                notif_svc.create(
                    user_id=uid,
                    notif_type=f"swap_{status_word}",
                    title=f"Swap {status_word.capitalize()}",
                    body=f"Your shift swap was {status_word} by the manager.",
                    data={"swap_id": swap_id},
                )

        return {"swap": swap, "conflicts": self._legacy_conflicts(validation) if validation else {"requester": [], "receiver": []},
                "validation": validation}

    # ── Resulting-schedule validation ─────────────────────────────────────────
    def evaluate_swap(self, swap: ShiftSwap) -> dict:
        return self.evaluate(
            shift_id=swap.shift_id, requesting_user_id=swap.requesting_user_id,
            offered_shift_id=swap.offered_shift_id, receiving_user_id=swap.receiving_user_id,
        )

    def evaluate(self, *, shift_id, requesting_user_id, offered_shift_id, receiving_user_id) -> dict:
        """Apply the swap in memory and run the normal scheduling rules on the result.

        Requester gives `shift_id` and receives `offered_shift_id`; the receiver does the
        opposite. Each person is checked against their schedule *after* the swap: the
        shift they give up no longer counts, everything else they work still does."""
        give = Shift.query.get(shift_id)
        take = Shift.query.get(offered_shift_id) if offered_shift_id else None
        errors, availability, warnings = [], [], []
        result = {"requester": None, "receiver": None}

        def still_assigned(sh, uid, label):
            if not sh or sh.status != "published":
                errors.append(f"{label} is no longer on the published schedule.")
                return False
            if not ShiftAssignment.query.filter_by(shift_id=sh.shift_id, user_id=uid).first():
                errors.append(f"{self._name(uid)} is no longer assigned to {label.lower()}.")
                return False
            return True

        ok_give = still_assigned(give, requesting_user_id, "The shift being given")
        ok_take = True
        if offered_shift_id:
            ok_take = still_assigned(take, receiving_user_id, "The shift offered in return")

        def place(uid, gains, gives_id, role):
            p = check_placement(
                user_id=uid, location_id=gains.location_id,
                start=gains.start_time, end=gains.end_time, break_minutes=gains.break_minutes,
                role_id=gains.role_id, ignore_shift_ids=[gives_id],
            )
            d = p.to_dict()
            d.update({"gives": self._serialize_shift(Shift.query.get(gives_id)) if gives_id else None,
                      "receives": self._serialize_shift(gains)})
            errors.extend(e["message"] for e in p.errors)
            if p.availability:
                availability.append(p.availability)
            warnings.extend(w["message"] for w in p.warnings)
            result[role] = d

        if receiving_user_id and ok_give and ok_take:
            if take is not None:
                place(requesting_user_id, take, shift_id, "requester")
            place(receiving_user_id, give, offered_shift_id, "receiver")

        return {
            "ok": not errors,
            "needs_override": bool(availability) and not errors,
            "errors": errors,
            "availability": availability,
            "warnings": warnings,
            **result,
        }

    @staticmethod
    def _raise_if_conflict(validation: dict):
        if validation["errors"]:
            raise SwapConflict("This swap can't go ahead: " + "; ".join(validation["errors"]) + ".", validation)

    def _legacy_conflicts(self, validation: dict) -> dict:
        """The older {requester: [shift], receiver: [shift]} shape, kept for existing clients."""
        out = {"requester": [], "receiver": []}
        for role in ("requester", "receiver"):
            for e in (validation.get(role) or {}).get("errors", []):
                if e.get("code") == "OVERLAP" and e.get("shift_id"):
                    sh = Shift.query.get(e["shift_id"])
                    if sh:
                        out[role].append({
                            "shift_id": sh.shift_id,
                            "start_time": sh.start_time.isoformat(),
                            "end_time": sh.end_time.isoformat(),
                            "role": sh.role.name if sh.role else None,
                        })
        return out

    # ── Conflict check ────────────────────────────────────────────────────────
    def check_conflicts(self, swap: ShiftSwap) -> dict:
        """Overlaps either party would have after the swap (older response shape)."""
        if not swap.receiving_user_id:
            return {"requester": [], "receiver": []}
        return self._legacy_conflicts(self.evaluate_swap(swap))

    # ── Queries ───────────────────────────────────────────────────────────────
    def get_my_swaps(self, user_id: int):
        return (
            ShiftSwap.query
            .filter_by(requesting_user_id=user_id)
            .order_by(ShiftSwap.created_at.desc())
            .all()
        )

    def get_incoming(self, user_id: int):
        """Targeted swaps where I'm the receiver OR open swaps where I made an offer."""
        return (
            ShiftSwap.query
            .filter(
                ShiftSwap.receiving_user_id == user_id,
                ShiftSwap.requesting_user_id != user_id,
            )
            .order_by(ShiftSwap.created_at.desc())
            .all()
        )

    def get_open_marketplace(self, location_id: int, exclude_user_id: int):
        """Open swaps from colleagues at this location."""
        return (
            db.session.query(ShiftSwap)
            .join(Shift, Shift.shift_id == ShiftSwap.shift_id)
            .filter(
                Shift.location_id          == location_id,
                ShiftSwap.swap_type        == "open",
                ShiftSwap.status           == "pending",
                ShiftSwap.requesting_user_id != exclude_user_id,
            )
            .order_by(ShiftSwap.created_at.desc())
            .all()
        )

    def get_pending_manager(self, location_id: int):
        return (
            db.session.query(ShiftSwap)
            .join(Shift, Shift.shift_id == ShiftSwap.shift_id)
            .filter(
                Shift.location_id == location_id,
                ShiftSwap.status  == "accepted",
            )
            .order_by(ShiftSwap.created_at.asc())
            .all()
        )

    def get_my_shifts_for_offer(self, user_id: int):
        """My upcoming published shifts that aren't already in a pending swap."""
        from datetime import timezone
        now = datetime.now(timezone.utc)
        shifts = (
            db.session.query(Shift)
            .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.shift_id)
            .filter(
                ShiftAssignment.user_id == user_id,
                Shift.status            == "published",
                Shift.start_time        > now,
            )
            .all()
        )
        # Exclude shifts already in a pending swap
        in_swap = {
            s.shift_id for s in
            ShiftSwap.query.filter_by(requesting_user_id=user_id, status="pending").all()
        }
        return [s for s in shifts if s.shift_id not in in_swap]

    # ── Serialization ─────────────────────────────────────────────────────────
    def serialize(self, swap: ShiftSwap, include_conflicts: bool = False) -> dict:
        req_shift = Shift.query.get(swap.shift_id)
        off_shift = Shift.query.get(swap.offered_shift_id) if swap.offered_shift_id else None
        requester = AppUser.query.get(swap.requesting_user_id)
        receiver  = AppUser.query.get(swap.receiving_user_id) if swap.receiving_user_id else None

        result = {
            "swap_id":            swap.swap_id,
            "swap_type":          swap.swap_type,
            "status":             swap.status,
            "reason":             swap.reason,
            "manager_approved":   swap.manager_approved,
            "ai_suggested":       swap.ai_suggested,
            "created_at":         swap.created_at.isoformat(),

            "requester": {
                "user_id":      requester.user_id if requester else None,
                "name":         requester.display_name or requester.username if requester else None,
            },
            "receiver": {
                "user_id":      receiver.user_id if receiver else None,
                "name":         receiver.display_name or receiver.username if receiver else None,
            } if receiver else None,

            "shift": self._serialize_shift(req_shift),
            "offered_shift": self._serialize_shift(off_shift) if off_shift else None,
        }

        if include_conflicts:
            if swap.receiving_user_id and swap.status in ("pending", "offer_pending", "accepted"):
                validation = self.evaluate_swap(swap)
                result["conflicts"] = self._legacy_conflicts(validation)
                result["validation"] = validation
            else:
                result["conflicts"] = {"requester": [], "receiver": []}

        return result

    @staticmethod
    def _serialize_shift(shift) -> dict | None:
        if not shift:
            return None
        return {
            "shift_id":      shift.shift_id,
            "start_time":    shift.start_time.isoformat(),
            "end_time":      shift.end_time.isoformat(),
            "break_minutes": shift.break_minutes,
            "role":          shift.role.name if shift.role else None,
            "location":      shift.location.loc_name if shift.location else None,
        }

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _get(swap_id: int) -> ShiftSwap:
        swap = ShiftSwap.query.get(swap_id)
        if not swap:
            raise ValueError("Swap not found.")
        return swap

    @staticmethod
    def _assert_assigned(shift_id: int, user_id: int):
        if not ShiftAssignment.query.filter_by(shift_id=shift_id, user_id=user_id).first():
            raise ValueError("You are not assigned to this shift.")

    @staticmethod
    def _name(user_id) -> str:
        u = AppUser.query.get(user_id) if user_id else None
        return (u.display_name or u.username) if u else "Someone"

    @staticmethod
    def _assert_same_location_staff(shift_id, offered_shift_id, requester_id, receiver_id):
        """Both shifts at one location, both people active there: no cross-company swaps."""
        a, b = Shift.query.get(shift_id), Shift.query.get(offered_shift_id)
        if not a or not b or a.location_id != b.location_id:
            raise ValueError("Both shifts must be at the same location.")
        for uid in (requester_id, receiver_id):
            if not Employment.query.filter_by(user_id=uid, location_id=a.location_id, status="active").first():
                raise ValueError("Both people must be active employees at this location.")

    @staticmethod
    def _assert_shift_available(shift_id: int):
        shift = Shift.query.get(shift_id)
        if not shift or shift.status != "published":
            raise ValueError("Shift is not available for swapping.")

    @staticmethod
    def _assert_no_pending(shift_id: int, user_id: int):
        if ShiftSwap.query.filter_by(
            shift_id=shift_id, requesting_user_id=user_id, status="pending"
        ).first():
            raise ValueError("You already have a pending swap for this shift.")

    @staticmethod
    def _assert_manager(user_id: int, location_id: int):
        emp = Employment.query.filter_by(
            user_id=user_id, location_id=location_id, status="active"
        ).first()
        if not emp or (emp.role.name if emp.role else "").lower() not in ("owner", "manager"):
            raise PermissionError("Manager access required.")

    @staticmethod
    def _overlaps(s1: Shift, s2: Shift) -> bool:
        return s1.start_time < s2.end_time and s1.end_time > s2.start_time

    def _notify_location_staff(self, swap: ShiftSwap):
        shift     = Shift.query.get(swap.shift_id)
        requester = AppUser.query.get(swap.requesting_user_id)
        name      = requester.display_name or requester.username
        emps = Employment.query.filter(
            Employment.location_id == shift.location_id,
            Employment.status      == "active",
            Employment.user_id     != swap.requesting_user_id,
        ).all()
        for emp in emps:
            notif_svc.create(
                user_id=emp.user_id,
                notif_type="swap_requested",
                title="Shift Available for Swap",
                body=(
                    f"{name} is looking to swap their shift on "
                    f"{tzu.shift_local_str(shift)}. "
                    f"Offer one of your shifts in return."
                ),
                data={"swap_id": swap.swap_id},
            )

    def _notify_managers_approval(self, swap: ShiftSwap, shift: Shift):
        emps = Employment.query.filter_by(location_id=shift.location_id, status="active").all()
        managers = [e for e in emps if e.role and e.role.name.lower() in ("owner", "manager")]
        req  = AppUser.query.get(swap.requesting_user_id)
        recv = AppUser.query.get(swap.receiving_user_id)
        for mgr in managers:
            notif_svc.create(
                user_id=mgr.user_id,
                notif_type="swap_needs_approval",
                title="Swap Needs Approval",
                body=(
                    f"{req.display_name or req.username} ↔ "
                    f"{recv.display_name or recv.username} agreed to swap shifts. Tap to review."
                ),
                data={"swap_id": swap.swap_id},
            )