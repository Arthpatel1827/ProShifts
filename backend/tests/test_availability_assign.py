# tests/test_availability_assign.py
"""Assigning outside someone's availability: warned (409) unless the manager overrides."""
from datetime import time, timedelta

from extensions import db
from models import Availability, Employment, ShiftAssignment
from tests.conftest import next_monday

MON = next_monday()


def set_availability(app, user_id, day="mon", start=time(9), end=time(17)):
    with app.app_context():
        emp = Employment.query.filter_by(user_id=user_id, status="active").first()
        db.session.add(Availability(emp_id=emp.emp_id, day_of_week=day, start_time=start, end_time=end))
        db.session.commit()


def assign(client, world, shift_id, user_id, override=None):
    body = {"user_id": user_id}
    if override is not None:
        body["allow_outside_availability"] = override
    return client.post(f"/shifts/{shift_id}/assign", headers=world.headers(world.manager_a), json=body)


def assigned(app, shift_id):
    with app.app_context():
        return sorted(a.user_id for a in ShiftAssignment.query.filter_by(shift_id=shift_id).all())


def test_assign_outside_availability_warns_then_allows_override(app, client, world):
    set_availability(app, world.staff_a)  # Mon 9-5
    sid = world.shift(world.loc_a, MON + timedelta(hours=17), hours=5)  # Mon 5-10pm
    res = assign(client, world, sid, world.staff_a)
    assert res.status_code == 409
    assert res.get_json() == {"error": "Outside Sam Staff's availability (Mon 17:00–22:00)", "code": "OUTSIDE_AVAILABILITY"}
    assert assigned(app, sid) == []
    assert assign(client, world, sid, world.staff_a, override=True).status_code == 200
    assert assigned(app, sid) == [world.staff_a]


def test_assign_inside_availability_or_none_on_file(app, client, world):
    set_availability(app, world.staff_a)
    inside = world.shift(world.loc_a, MON + timedelta(hours=10), hours=4)
    assert assign(client, world, inside, world.staff_a).status_code == 200
    # Ria has no availability on file: nothing to check.
    assert assign(client, world, world.shift(world.loc_a, MON + timedelta(hours=20), hours=3), world.staff_a2).status_code == 200


def test_overnight_needs_both_days_covered(app, client, world):
    set_availability(app, world.staff_a, "mon", time(18), time(23, 59))
    sid = world.shift(world.loc_a, MON + timedelta(hours=22), hours=4)  # Mon 22:00 - Tue 02:00
    res = assign(client, world, sid, world.staff_a)
    assert res.status_code == 409 and "Tue 00:00–02:00" in res.get_json()["error"]
    set_availability(app, world.staff_a, "tue", time(0), time(6))
    assert assign(client, world, sid, world.staff_a).status_code == 200


def test_other_rules_still_win_over_override(app, client, world):
    set_availability(app, world.staff_a)
    world.shift(world.loc_a, MON + timedelta(hours=18), hours=3, assign=[world.staff_a])
    clash = world.shift(world.loc_a, MON + timedelta(hours=19), hours=2)
    res = assign(client, world, clash, world.staff_a, override=True)  # override is only for availability
    assert res.status_code == 400 and "overlaps" in res.get_json()["error"]


def bulk(client, world, override=None):
    body = {"location_id": world.loc_a, "week_start": MON.date().isoformat(), "rows": [
        {"user_id": world.staff_a, "role_id": world.role_barista, "start_time": "18:00", "end_time": "22:00", "days": [0, 1]},
    ]}
    if override is not None:
        body["allow_outside_availability"] = override
    return client.post("/shifts/bulk-week", headers=world.headers(world.manager_a), json=body).get_json()


def test_bulk_skips_outside_availability_unless_included(app, client, world):
    set_availability(app, world.staff_a, "mon", time(9), time(17))   # Mon: not evenings
    set_availability(app, world.staff_a, "tue", time(16), time(23))  # Tue: evenings fine
    body = bulk(client, world)
    assert body["created_count"] == 1
    assert body["skipped"][0]["code"] == "OUTSIDE_AVAILABILITY" and "Mon 18:00–22:00" in body["skipped"][0]["reason"]
    # Including people outside availability creates the Monday one too (Tuesday now overlaps).
    again = bulk(client, world, override=True)
    assert again["created_count"] == 1 and [s["reason"] for s in again["skipped"]] == ["Overlaps an existing shift"]


def test_copy_leaves_open_when_outside_availability_unless_included(app, client, world):
    set_availability(app, world.staff_a, "mon", time(8), time(18))
    src = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a])
    tue = (MON + timedelta(days=1)).date().isoformat()  # no Tuesday availability
    res = client.post("/shifts/copy", headers=world.headers(world.manager_a),
                      json={"location_id": world.loc_a, "items": [{"shift_id": src, "date": tue}]}).get_json()
    assert res["created_count"] == 1 and assigned(app, res["created_ids"][0]) == []
    assert res["unassigned"][0]["reason"] == "Outside Sam Staff's availability (Tue 09:00–17:00)"
    wed = (MON + timedelta(days=2)).date().isoformat()
    res = client.post("/shifts/copy", headers=world.headers(world.manager_a), json={
        "location_id": world.loc_a, "items": [{"shift_id": src, "date": wed}], "allow_outside_availability": True}).get_json()
    assert assigned(app, res["created_ids"][0]) == [world.staff_a]
