# tests/test_shift_copy.py
"""Copy/paste shifts (POST /shifts/copy) and bulk-week role validation."""
from datetime import datetime, timedelta, timezone

from extensions import db
from models import Location, Shift, TimeOffRequest
from tests.conftest import next_monday

MON = next_monday()


def copy(client, world, items, who=None, include_assignees=True, location_id=None):
    return client.post("/shifts/copy", headers=world.headers(who or world.manager_a), json={
        "location_id": location_id or world.loc_a, "items": items, "include_assignees": include_assignees,
    })


def shift(app, sid):
    with app.app_context():
        s = Shift.query.get(sid)
        return {"start": s.start_time, "end": s.end_time, "status": s.status, "role_id": s.role_id,
                "break": s.break_minutes, "users": sorted(a.user_id for a in s.assignments)}


def test_copy_shift_to_other_days_with_staff(app, client, world):
    src = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a], status="published", break_minutes=30)
    tue, wed = (MON + timedelta(days=1)).date(), (MON + timedelta(days=2)).date()
    res = copy(client, world, [{"shift_id": src, "date": tue.isoformat()}, {"shift_id": src, "date": wed.isoformat()}])
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["created_count"] == 2 and body["skipped"] == [] and body["unassigned"] == []
    for sid, d in zip(body["created_ids"], (tue, wed)):
        s = shift(app, sid)
        assert s["status"] == "draft"  # copies are never published automatically
        assert s["start"] == datetime(d.year, d.month, d.day, 9, tzinfo=timezone.utc)
        assert s["end"] - s["start"] == timedelta(hours=8) and s["break"] == 30
        assert s["users"] == [world.staff_a]


def test_copy_twice_skips_identical(client, world):
    src = world.shift(world.loc_a, MON + timedelta(hours=9))
    item = [{"shift_id": src, "date": (MON + timedelta(days=1)).date().isoformat()}]
    assert copy(client, world, item).get_json()["created_count"] == 1
    again = copy(client, world, item).get_json()
    assert again["created_count"] == 0 and "identical shift" in again["skipped"][0]["reason"]


def test_copy_keeps_overnight_shift_overnight(app, client, world):
    src = world.shift(world.loc_a, MON + timedelta(hours=22), hours=6, assign=[world.staff_a])
    sid = copy(client, world, [{"shift_id": src, "date": (MON + timedelta(days=3)).date().isoformat()}]).get_json()["created_ids"][0]
    s = shift(app, sid)
    assert s["start"].hour == 22 and s["end"] - s["start"] == timedelta(hours=6)


def test_copy_respects_dst_wall_clock(app, client, world):
    # Toronto: Nov 1 2026 clocks go back. A 9 a.m. shift stays 9 a.m. local on both sides.
    with app.app_context():
        Location.query.get(world.loc_a).timezone = "America/Toronto"
        db.session.commit()
    src = world.shift(world.loc_a, datetime(2026, 10, 26, 13, tzinfo=timezone.utc))  # 9:00 EDT
    sid = copy(client, world, [{"shift_id": src, "date": "2026-11-02"}]).get_json()["created_ids"][0]
    assert shift(app, sid)["start"] == datetime(2026, 11, 2, 14, tzinfo=timezone.utc)  # 9:00 EST


def test_copy_leaves_shift_open_when_staff_cannot_work(app, client, world):
    tue = (MON + timedelta(days=1)).date()
    src = world.shift(world.loc_a, MON + timedelta(hours=9), assign=[world.staff_a, world.staff_a2])
    world.shift(world.loc_a, MON + timedelta(days=1, hours=12), hours=2, assign=[world.staff_a2])  # overlap Tue
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=world.staff_a, comp_id=world.comp_a, start_date=tue, end_date=tue, status="approved"))
        db.session.commit()
    body = copy(client, world, [{"shift_id": src, "date": tue.isoformat()}]).get_json()
    assert body["created_count"] == 1
    reasons = {u["name"]: u["reason"] for u in body["unassigned"]}
    assert reasons == {"Sam Staff": "Has approved time off", "Ria Barista": "Already has a shift that overlaps"}
    assert shift(app, body["created_ids"][0])["users"] == []


def test_copy_without_staff(app, client, world):
    src = world.shift(world.loc_a, MON + timedelta(hours=9), assign=[world.staff_a])
    sid = copy(client, world, [{"shift_id": src, "date": (MON + timedelta(days=2)).date().isoformat()}],
               include_assignees=False).get_json()["created_ids"][0]
    assert shift(app, sid)["users"] == []


def test_copy_week_style_batch_detects_overlap_within_batch(app, client, world):
    # Two source shifts for the same person that would collide on the same target date.
    a = world.shift(world.loc_a, MON + timedelta(hours=9), hours=8, assign=[world.staff_a])
    b = world.shift(world.loc_a, MON + timedelta(days=1, hours=12), hours=4, assign=[world.staff_a])
    target = (MON + timedelta(days=7)).date().isoformat()
    body = copy(client, world, [{"shift_id": a, "date": target}, {"shift_id": b, "date": target}]).get_json()
    assert body["created_count"] == 2
    assert [u["reason"] for u in body["unassigned"]] == ["Already has a shift that overlaps"]


def test_copy_permissions_and_tenancy(client, world):
    src_b = world.shift(world.loc_b, MON + timedelta(hours=9))
    src_a = world.shift(world.loc_a, MON + timedelta(hours=9))
    d = (MON + timedelta(days=1)).date().isoformat()
    assert client.post("/shifts/copy", json={"location_id": world.loc_a, "items": []}).status_code == 401
    assert copy(client, world, [{"shift_id": src_a, "date": d}], who=world.staff_a).status_code == 403
    assert copy(client, world, [{"shift_id": src_b, "date": d}], location_id=world.loc_b).status_code == 403
    # Another company's shift ID through your own location: not found, nothing created.
    body = copy(client, world, [{"shift_id": src_b, "date": d}]).get_json()
    assert body["created_count"] == 0 and body["skipped"][0]["reason"] == "Shift not found at this location"
    assert copy(client, world, []).status_code == 400
    assert copy(client, world, [{"shift_id": src_a, "date": "tomorrow"}]).get_json()["skipped"][0]["reason"] == "date must be YYYY-MM-DD"


def test_bulk_week_rejects_other_locations_role(client, world):
    res = client.post("/shifts/bulk-week", headers=world.headers(world.manager_a), json={
        "location_id": world.loc_a, "week_start": MON.date().isoformat(),
        "rows": [
            {"user_id": world.staff_a, "role_id": world.role_owner_b, "start_time": "09:00", "end_time": "17:00", "days": [0]},
            {"user_id": world.staff_a2, "role_id": world.role_barista, "start_time": "09:00", "end_time": "17:00", "days": [0, 1]},
        ],
    })
    body = res.get_json()
    assert res.status_code == 201 and body["created_count"] == 2
    assert body["skipped"] == [{"index": 0, "reason": "Role isn't defined at this location"}]


def test_copy_keeps_several_people_on_the_same_slot(app, client, world):
    # Three separate shifts, same times and role, different people: all three copy.
    srcs = [world.shift(world.loc_a, MON + timedelta(hours=18), hours=5, assign=[u])
            for u in (world.staff_a, world.staff_a2, world.manager_a)]
    target = (MON + timedelta(days=7)).date().isoformat()
    body = copy(client, world, [{"shift_id": sid, "date": target} for sid in srcs]).get_json()
    assert body["created_count"] == 3 and body["skipped"] == []
    assert sorted(shift(app, i)["users"][0] for i in body["created_ids"]) == sorted([world.staff_a, world.staff_a2, world.manager_a])
    # And copying them again changes nothing.
    again = copy(client, world, [{"shift_id": sid, "date": target} for sid in srcs]).get_json()
    assert again["created_count"] == 0 and len(again["skipped"]) == 3


def test_copy_fills_matching_open_shift(app, client, world):
    src = world.shift(world.loc_a, MON + timedelta(hours=9), assign=[world.staff_a])
    open_ = world.shift(world.loc_a, MON + timedelta(days=7, hours=9))  # same slot next week, nobody on it
    body = copy(client, world, [{"shift_id": src, "date": (MON + timedelta(days=7)).date().isoformat()}]).get_json()
    assert body["created_count"] == 0 and body["filled_ids"] == [open_]
    assert shift(app, open_)["users"] == [world.staff_a]


def test_open_shift_not_counted_as_filled_when_staff_cannot_work(app, client, world):
    nxt = (MON + timedelta(days=7)).date()
    src = world.shift(world.loc_a, MON + timedelta(hours=9), assign=[world.staff_a])
    world.shift(world.loc_a, MON + timedelta(days=7, hours=9))
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=world.staff_a, comp_id=world.comp_a, start_date=nxt, end_date=nxt, status="approved"))
        db.session.commit()
    body = copy(client, world, [{"shift_id": src, "date": nxt.isoformat()}]).get_json()
    assert body["filled_count"] == 0 and body["created_count"] == 0
    assert body["unassigned"][0]["reason"] == "Has approved time off"
