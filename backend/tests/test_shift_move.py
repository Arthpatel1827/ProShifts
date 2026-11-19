# tests/test_shift_move.py
"""Drag & drop (POST /shifts/<id>/move) and manual shift editing (PUT /shifts/<id>)."""
from datetime import datetime, time, timedelta, timezone

from extensions import db
from models import (
    Availability, Company, Employment, Location, Notification, Shift, ShiftAssignment,
    TimeEntry, TimeOffRequest,
)
from tests.conftest import next_monday

MON = next_monday().replace(tzinfo=timezone.utc)
UTC = timezone.utc


def move(client, world, sid, who=None, **body):
    return client.post(f"/shifts/{sid}/move", headers=world.headers(who or world.manager_a), json=body)


def edit(client, world, sid, who=None, **body):
    return client.put(f"/shifts/{sid}", headers=world.headers(who or world.manager_a), json=body)


def get(app, sid):
    with app.app_context():
        s = Shift.query.get(sid)
        return {"start": s.start_time, "end": s.end_time, "break": s.break_minutes,
                "users": sorted(a.user_id for a in s.assignments),
                "breaks": [(b.start_time, b.end_time) for b in s.breaks]}


def day(n):
    return (MON + timedelta(days=n)).date().isoformat()


# ── A. another employee ──────────────────────────────────────────────────────
def test_drag_to_another_employee(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a], status="published")
    res = move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.staff_a2)
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["applied"] is True and get(app, sid)["users"] == [world.staff_a2]
    assert body["undo"] == {"date": day(0), "start": "10:00", "from_user_id": world.staff_a2, "to_user_id": world.staff_a}
    with app.app_context():  # published: both people hear about it
        assert Notification.query.filter_by(user_id=world.staff_a2, notif_type="shift_assigned").count() == 1
        assert Notification.query.filter_by(user_id=world.staff_a, notif_type="shift_unassigned").count() == 1


def test_give_open_shift_to_someone(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10))
    assert move(client, world, sid, to_user_id=world.staff_a2).status_code == 200
    assert get(app, sid)["users"] == [world.staff_a2]


# ── B. another time ──────────────────────────────────────────────────────────
def test_drag_to_another_time_keeps_length(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a])
    res = move(client, world, sid, start="11:00")
    assert res.status_code == 200, res.get_json()
    s = get(app, sid)
    assert s["start"] == MON + timedelta(hours=11) and s["end"] == MON + timedelta(hours=19)


def test_time_change_conflict_is_not_applied(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=4, assign=[world.staff_a])
    world.shift(world.loc_a, MON + timedelta(hours=14), hours=4, assign=[world.staff_a])
    res = move(client, world, sid, start="13:00")
    assert res.status_code == 409 and res.get_json()["code"] == "SCHEDULE_CONFLICT"
    assert "overlaps" in res.get_json()["error"]
    assert get(app, sid)["start"] == MON + timedelta(hours=9)  # nothing changed silently


# ── C. another day ───────────────────────────────────────────────────────────
def test_drag_to_another_day_keeps_times(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), hours=8, assign=[world.staff_a])
    assert move(client, world, sid, date=day(2)).status_code == 200
    s = get(app, sid)
    assert s["start"] == MON + timedelta(days=2, hours=10) and s["end"] == MON + timedelta(days=2, hours=18)


def test_day_and_person_in_one_drop(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a])
    assert move(client, world, sid, date=day(3), from_user_id=world.staff_a, to_user_id=world.staff_a2).status_code == 200
    s = get(app, sid)
    assert s["users"] == [world.staff_a2] and s["start"] == MON + timedelta(days=3, hours=10)


# ── E. overnight ─────────────────────────────────────────────────────────────
def test_overnight_shift_moves_as_one(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=22), hours=8, assign=[world.staff_a])  # Mon 22:00 → Tue 06:00
    assert move(client, world, sid, date=day(2)).status_code == 200
    s = get(app, sid)
    assert s["start"] == MON + timedelta(days=2, hours=22) and s["end"] == MON + timedelta(days=3, hours=6)
    with app.app_context():
        assert Shift.query.count() == 1  # still a single logical shift


# ── F. timezone / DST ────────────────────────────────────────────────────────
def _toronto(app, world):
    with app.app_context():
        Location.query.get(world.loc_a).timezone = "America/Toronto"
        db.session.commit()


def test_day_move_across_dst_keeps_wall_clock(app, client, world):
    _toronto(app, world)
    # Fri Oct 30 2026 9:00–17:00 EDT (13:00–21:00 UTC). Clocks go back Sun Nov 1.
    sid = world.shift(world.loc_a, datetime(2026, 10, 30, 13, tzinfo=UTC), hours=8, assign=[world.staff_a])
    assert move(client, world, sid, date="2026-11-02").status_code == 200
    s = get(app, sid)
    # Mon Nov 2 9:00–17:00 EST = 14:00–22:00 UTC: still 9 to 5 on the store's clock.
    assert s["start"] == datetime(2026, 11, 2, 14, tzinfo=UTC) and s["end"] == datetime(2026, 11, 2, 22, tzinfo=UTC)


def test_overnight_across_dst_keeps_wall_clock(app, client, world):
    _toronto(app, world)
    # Sat Oct 31 22:00 EDT → Sun Nov 1 06:00 EST (9 real hours, 22:00–06:00 on the clock).
    sid = world.shift(world.loc_a, datetime(2026, 11, 1, 2, tzinfo=UTC), hours=9, assign=[world.staff_a])
    assert move(client, world, sid, date="2026-11-07").status_code == 200
    s = get(app, sid)
    # Sat Nov 7 22:00 EST → Sun Nov 8 06:00 EST = 03:00–11:00 UTC.
    assert s["start"] == datetime(2026, 11, 8, 3, tzinfo=UTC) and s["end"] == datetime(2026, 11, 8, 11, tzinfo=UTC)


def test_time_drag_uses_local_time(app, client, world):
    _toronto(app, world)
    sid = world.shift(world.loc_a, datetime(2026, 11, 3, 14, tzinfo=UTC), hours=8)  # Tue 9:00 EST
    assert move(client, world, sid, start="07:30").status_code == 200
    assert get(app, sid)["start"] == datetime(2026, 11, 3, 12, 30, tzinfo=UTC)


# ── validation ───────────────────────────────────────────────────────────────
def _ria_available_mornings(app, world):
    with app.app_context():
        emp = Employment.query.filter_by(user_id=world.staff_a2).first()
        for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            db.session.add(Availability(emp_id=emp.emp_id, day_of_week=d, start_time=time(6), end_time=time(12)))
        db.session.commit()


def test_availability_warns_then_manager_overrides(app, client, world):
    _ria_available_mornings(app, world)
    sid = world.shift(world.loc_a, MON + timedelta(hours=13), hours=5, assign=[world.staff_a])
    res = move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.staff_a2)
    assert res.status_code == 409 and res.get_json()["code"] == "OUTSIDE_AVAILABILITY"
    assert "Outside Ria Barista's availability" in res.get_json()["error"]
    assert get(app, sid)["users"] == [world.staff_a]
    res = move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.staff_a2, allow_outside_availability=True)
    assert res.status_code == 200 and get(app, sid)["users"] == [world.staff_a2]


def test_time_off_blocks(app, client, world):
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=world.staff_a2, comp_id=world.comp_a, start_date=(MON + timedelta(days=2)).date(),
                                      end_date=(MON + timedelta(days=2)).date(), status="approved"))
        db.session.commit()
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a2])
    res = move(client, world, sid, date=day(2))
    assert res.status_code == 409 and "time off" in res.get_json()["error"]


def test_double_booking_blocks(app, client, world):
    world.shift(world.loc_a, MON + timedelta(hours=12), hours=4, assign=[world.staff_a2])
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a])
    res = move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.staff_a2)
    assert res.status_code == 409
    placement = res.get_json()["placements"][0]
    assert placement["user_id"] == world.staff_a2 and placement["errors"][0]["code"] == "OVERLAP"


def test_overtime_is_a_warning(app, client, world):
    for d in range(4):
        world.shift(world.loc_a, MON + timedelta(days=d, hours=7), hours=10, assign=[world.staff_a2])
    sid = world.shift(world.loc_a, MON + timedelta(days=5, hours=9), hours=8, assign=[world.staff_a])
    res = move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.staff_a2)
    assert res.status_code == 200
    assert any("Overtime" in w for w in res.get_json()["warnings"])


def test_invalid_drops(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a])
    assert move(client, world, sid, who=world.staff_a, date=day(1)).status_code == 403  # staff can't
    assert move(client, world, sid, who=world.owner_b, date=day(1)).status_code == 403  # other company
    res = move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.owner_b)  # outsider
    assert res.status_code == 409 and res.get_json()["placements"][0]["errors"][0]["code"] == "NOT_ACTIVE"
    assert move(client, world, sid, date=day(0)).status_code == 400  # same place
    assert move(client, world, sid, from_user_id=world.staff_a2, to_user_id=world.manager_a).status_code == 400  # not on it
    assert move(client, world, sid, date="soon").status_code == 400
    with app.app_context():
        Shift.query.get(sid).status = "cancelled"
        db.session.commit()
    assert move(client, world, sid, date=day(1)).status_code == 400


def test_inactive_employee_cannot_receive(app, client, world):
    with app.app_context():
        Employment.query.filter_by(user_id=world.staff_a2).first().status = "inactive"
        db.session.commit()
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a])
    assert move(client, world, sid, from_user_id=world.staff_a, to_user_id=world.staff_a2).status_code == 409


def test_dry_run_changes_nothing(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a])
    res = move(client, world, sid, date=day(4), dry_run=True)
    assert res.status_code == 200 and res.get_json()["applied"] is False
    assert get(app, sid)["start"] == MON + timedelta(hours=10)


def test_worked_shift_cannot_be_moved(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=10), assign=[world.staff_a])
    with app.app_context():
        db.session.add(TimeEntry(user_id=world.staff_a, shift_id=sid, clock_in=MON + timedelta(hours=10)))
        db.session.commit()
    res = move(client, world, sid, start="12:00")
    assert res.status_code == 400 and "time entry" in res.get_json()["error"]


# ── manual editing ───────────────────────────────────────────────────────────
def test_edit_times_revalidates_assignees(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=4, assign=[world.staff_a])
    world.shift(world.loc_a, MON + timedelta(hours=15), hours=4, assign=[world.staff_a])
    res = edit(client, world, sid, end_time=(MON + timedelta(hours=16)).replace(tzinfo=None).isoformat())
    assert res.status_code == 409 and res.get_json()["code"] == "SCHEDULE_CONFLICT"
    assert get(app, sid)["end"] == MON + timedelta(hours=13)
    res = edit(client, world, sid, start_time=(MON + timedelta(hours=9, minutes=30)).replace(tzinfo=None).isoformat(),
               end_time=(MON + timedelta(hours=13, minutes=30)).replace(tzinfo=None).isoformat())
    assert res.status_code == 200
    assert get(app, sid)["start"] == MON + timedelta(hours=9, minutes=30)


def test_edit_breaks(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a])
    naive = lambda h, m=0: (MON + timedelta(hours=h, minutes=m)).replace(tzinfo=None).isoformat()
    res = edit(client, world, sid, breaks=[{"start_time": naive(12), "end_time": naive(12, 30)},
                                           {"start_time": naive(15), "end_time": naive(15, 15)}])
    assert res.status_code == 200, res.get_json()
    body = res.get_json()["shift"]
    assert body["break_minutes"] == 45 and [b["minutes"] for b in body["breaks"]] == [30, 15]
    # Change one, remove the other.
    res = edit(client, world, sid, breaks=[{"start_time": naive(13), "end_time": naive(14)}])
    assert res.get_json()["shift"]["break_minutes"] == 60 and len(res.get_json()["shift"]["breaks"]) == 1
    # Remove all breaks.
    res = edit(client, world, sid, breaks=[], break_minutes=0)
    assert res.get_json()["shift"]["break_minutes"] == 0 and res.get_json()["shift"]["breaks"] == []


def test_break_rules(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8)
    naive = lambda h, m=0: (MON + timedelta(hours=h, minutes=m)).replace(tzinfo=None).isoformat()
    outside = edit(client, world, sid, breaks=[{"start_time": naive(8), "end_time": naive(9, 30)}])
    assert outside.status_code == 400 and "inside the shift" in outside.get_json()["error"]
    overlap = edit(client, world, sid, breaks=[{"start_time": naive(12), "end_time": naive(13)},
                                               {"start_time": naive(12, 30), "end_time": naive(13, 30)}])
    assert overlap.status_code == 400
    with app.app_context():
        Company.query.get(world.comp_a).max_breaks_per_shift = 1
        db.session.commit()
    too_many = edit(client, world, sid, breaks=[{"start_time": naive(11), "end_time": naive(11, 15)},
                                                {"start_time": naive(14), "end_time": naive(14, 15)}])
    assert too_many.status_code == 400 and "At most 1 break" in too_many.get_json()["error"]


def test_breaks_move_with_the_shift(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8)
    naive = lambda h, m=0: (MON + timedelta(hours=h, minutes=m)).replace(tzinfo=None).isoformat()
    edit(client, world, sid, breaks=[{"start_time": naive(12), "end_time": naive(12, 30)}])
    assert move(client, world, sid, date=day(1), start="10:00").status_code == 200
    (bs, be), = get(app, sid)["breaks"]
    assert bs == MON + timedelta(days=1, hours=13) and be == MON + timedelta(days=1, hours=13, minutes=30)


def test_edit_never_touches_time_entries(app, client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a])
    with app.app_context():
        db.session.add(TimeEntry(user_id=world.staff_a, shift_id=sid, clock_in=MON + timedelta(hours=9, minutes=3),
                                 clock_out=MON + timedelta(hours=17), total_minutes=477))
        db.session.commit()
    assert edit(client, world, sid, notes="Bring keys").status_code == 200
    with app.app_context():
        e = TimeEntry.query.first()
        assert e.clock_in == MON + timedelta(hours=9, minutes=3) and e.total_minutes == 477


def test_staff_cannot_edit(client, world):
    sid = world.shift(world.loc_a, MON + timedelta(hours=9))
    assert edit(client, world, sid, who=world.staff_a, notes="x").status_code == 403


# ── week status (filters) ────────────────────────────────────────────────────
def test_week_status_clock_and_flags(app, client, world, monkeypatch):
    from utils import timezones as tzu
    now = MON + timedelta(days=1, hours=12)  # Tue noon
    monkeypatch.setattr(tzu, "utc_now", lambda: now)
    ended = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a], status="published")
    missed = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a2], status="published")
    working = world.shift(world.loc_a, MON + timedelta(days=1, hours=9), hours=8, assign=[world.staff_a], status="published")
    late = world.shift(world.loc_a, MON + timedelta(days=1, hours=11), hours=4, assign=[world.staff_a2], status="published")
    later = world.shift(world.loc_a, MON + timedelta(days=3, hours=9), hours=8, assign=[world.staff_a], status="published")
    draft = world.shift(world.loc_a, MON + timedelta(days=4, hours=9), hours=8, assign=[world.staff_a])
    with app.app_context():
        db.session.add(TimeEntry(user_id=world.staff_a, shift_id=ended, clock_in=MON + timedelta(hours=9),
                                 clock_out=MON + timedelta(hours=17), total_minutes=480))
        db.session.add(TimeEntry(user_id=world.staff_a, shift_id=working, clock_in=MON + timedelta(days=1, hours=9, minutes=20)))
        emp = Employment.query.filter_by(user_id=world.staff_a2).first()
        db.session.add(Availability(emp_id=emp.emp_id, day_of_week="mon", start_time=time(12), end_time=time(23)))
        db.session.commit()
    res = client.get(f"/shifts/week-status?location_id={world.loc_a}&week_start={day(0)}", headers=world.headers(world.manager_a))
    assert res.status_code == 200
    by = {(i["shift_id"], i["user_id"]): i for i in res.get_json()["items"]}
    assert by[(ended, world.staff_a)]["clock_status"] == "ended"
    assert by[(missed, world.staff_a2)]["clock_status"] == "missed"
    assert "availability" in by[(missed, world.staff_a2)]["flags"]
    w = by[(working, world.staff_a)]
    assert w["clock_status"] == "working" and w["late_arrival"] is True
    assert by[(late, world.staff_a2)]["clock_status"] == "late"
    assert by[(later, world.staff_a)]["clock_status"] == "not_started"
    assert by[(draft, world.staff_a)]["clock_status"] is None
    assert client.get(f"/shifts/week-status?location_id={world.loc_a}&week_start={day(0)}",
                      headers=world.headers(world.staff_a)).status_code == 403
    assert client.get(f"/shifts/week-status?location_id={world.loc_a}&week_start={day(0)}",
                      headers=world.headers(world.owner_b)).status_code == 403


# ── /shifts/mine and overnight shifts crossing into the week ────────────────
def test_mine_includes_previous_sunday_overnight_once(app, client, world):
    sun_night = world.shift(world.loc_a, MON - timedelta(hours=2), hours=8, assign=[world.staff_a], status="published")  # Sun 22:00 → Mon 06:00
    mon = world.shift(world.loc_a, MON + timedelta(hours=12), hours=4, assign=[world.staff_a], status="published")
    sun_out = world.shift(world.loc_a, MON + timedelta(days=6, hours=22), hours=8, assign=[world.staff_a], status="published")  # into next week
    h = world.headers(world.staff_a)
    plain = client.get(f"/shifts/mine?week_start={day(0)}", headers=h).get_json()["shifts"]
    assert [s["shift_id"] for s in plain] == [mon, sun_out]  # unchanged default (home screen counts)
    over = client.get(f"/shifts/mine?week_start={day(0)}&include_overlapping=1", headers=h).get_json()["shifts"]
    ids = [s["shift_id"] for s in over]
    assert ids == [sun_night, mon, sun_out] and len(set(ids)) == 3  # one record each, never duplicated
    nxt = client.get(f"/shifts/mine?week_start={day(7)}&include_overlapping=1", headers=h).get_json()["shifts"]
    assert [s["shift_id"] for s in nxt] == [sun_out]
