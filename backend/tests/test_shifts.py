from datetime import timedelta

from tests.conftest import next_monday


def _iso(dt):
    return dt.isoformat()


def test_manager_creates_draft_shift(client, world):
    start = next_monday().replace(hour=9)
    res = client.post("/shifts/", headers=world.headers(world.manager_a), json={
        "location_id": world.loc_a, "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=8)),
        "role_id": world.role_barista, "break_minutes": 30, "notes": "Open up",
    })
    assert res.status_code == 201
    shift = res.get_json()["shift"]
    assert shift["status"] == "draft" and shift["role"] == "Barista" and shift["break_minutes"] == 30


def test_overnight_shift_is_accepted_but_reversed_times_are_not(client, world):
    start = next_monday().replace(hour=22)
    h = world.headers(world.manager_a)
    ok = client.post("/shifts/", headers=h, json={
        "location_id": world.loc_a, "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=8)),
    })
    assert ok.status_code == 201
    bad = client.post("/shifts/", headers=h, json={
        "location_id": world.loc_a, "start_time": _iso(start), "end_time": _iso(start - timedelta(hours=1)),
    })
    assert bad.status_code == 400


def test_staff_cannot_create_shifts(client, world):
    start = next_monday().replace(hour=9)
    res = client.post("/shifts/", headers=world.headers(world.staff_a), json={
        "location_id": world.loc_a, "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=4)),
    })
    assert res.status_code == 403


def test_manager_cannot_touch_another_companys_location(client, world):
    start = next_monday().replace(hour=9)
    h = world.headers(world.manager_a)
    assert client.get(f"/shifts/?location_id={world.loc_b}", headers=h).status_code == 403
    assert client.post("/shifts/", headers=h, json={
        "location_id": world.loc_b, "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=4)),
    }).status_code == 403
    other = world.shift(world.loc_b, start)
    assert client.put(f"/shifts/{other}", headers=h, json={"notes": "x"}).status_code == 403
    assert client.delete(f"/shifts/{other}", headers=h).status_code == 403


def test_assign_rejects_overlapping_shift(client, world):
    start = next_monday().replace(hour=9)
    world.shift(world.loc_a, start, hours=8, assign=[world.staff_a])
    clash = world.shift(world.loc_a, start + timedelta(hours=4), hours=6)
    res = client.post(f"/shifts/{clash}/assign", headers=world.headers(world.manager_a), json={"user_id": world.staff_a})
    assert res.status_code == 400
    assert "overlap" in res.get_json()["error"].lower()


def test_assign_rejects_employee_on_approved_time_off(client, world, app):
    from extensions import db
    from models import TimeOffRequest
    start = next_monday().replace(hour=9)
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=world.staff_a, comp_id=world.comp_a, start_date=start.date(),
                                      end_date=start.date(), status="approved"))
        db.session.commit()
    sid = world.shift(world.loc_a, start)
    res = client.post(f"/shifts/{sid}/assign", headers=world.headers(world.manager_a), json={"user_id": world.staff_a})
    assert res.status_code == 400
    assert "time off" in res.get_json()["error"].lower()


def test_assign_rejects_cancelled_shift_and_unassign_works(client, world):
    start = next_monday().replace(hour=9)
    h = world.headers(world.manager_a)
    sid = world.shift(world.loc_a, start)
    assert client.post(f"/shifts/{sid}/assign", headers=h, json={"user_id": world.staff_a}).status_code == 200
    assert client.delete(f"/shifts/{sid}/assign", headers=h, json={"user_id": world.staff_a}).status_code == 200
    assert client.delete(f"/shifts/{sid}", headers=h).get_json()["shift"]["status"] == "cancelled"
    assert client.post(f"/shifts/{sid}/assign", headers=h, json={"user_id": world.staff_a}).status_code == 400


def test_publish_week_moves_drafts_live(client, world):
    monday = next_monday()
    world.shift(world.loc_a, monday.replace(hour=9), assign=[world.staff_a])
    res = client.post("/shifts/publish", headers=world.headers(world.manager_a), json={
        "location_id": world.loc_a, "week_start": monday.date().isoformat(),
    })
    assert res.status_code == 200 and res.get_json()["published_count"] == 1
    listed = client.get(f"/shifts/mine?week_start={monday.date().isoformat()}", headers=world.headers(world.staff_a))
    assert len(listed.get_json()["shifts"]) == 1


def test_labor_cost_uses_each_employees_rate(client, world):
    monday = next_monday()
    # 8h with a 60 min break = 7 paid hours at $20, plus an unassigned 4h shift at the $15 fallback.
    world.shift(world.loc_a, monday.replace(hour=9), hours=8, break_minutes=60, assign=[world.staff_a])
    world.shift(world.loc_a, monday.replace(hour=12) + timedelta(days=1), hours=4)
    res = client.get(f"/shifts/labor-cost?location_id={world.loc_a}&week_start={monday.date().isoformat()}",
                     headers=world.headers(world.manager_a))
    body = res.get_json()
    assert res.status_code == 200
    assert body["total_hours"] == 11.0
    assert body["total_cost"] == 7 * 20 + 4 * 15
    assert body["unassigned_hours"] == 4.0


def test_labor_cost_is_not_readable_by_staff_or_other_companies(client, world):
    q = f"/shifts/labor-cost?location_id={world.loc_a}&week_start={next_monday().date().isoformat()}"
    assert client.get(q, headers=world.headers(world.staff_a)).status_code == 403
    assert client.get(q, headers=world.headers(world.owner_b)).status_code == 403


def test_shift_times_with_utc_offset_from_web(client, world):
    # The web app sends the browser's offset so the DB server's timezone can't shift it.
    monday = next_monday().date().isoformat()
    h = world.headers(world.manager_a)
    res = client.post("/shifts/", headers=h, json={
        "location_id": world.loc_a,
        "start_time": f"{monday}T22:00:00-04:00",
        "end_time": f"{monday}T23:30:00-04:00",
    })
    assert res.status_code == 201
    listed = client.get(f"/shifts/?location_id={world.loc_a}&week_start={monday}", headers=h).get_json()["shifts"]
    assert len(listed) == 1
    from datetime import datetime
    start = datetime.fromisoformat(listed[0]["start_time"])
    assert start.utcoffset() is not None
    assert (start.hour - start.utcoffset().total_seconds() / 3600) % 24 == 2  # 22:00-04:00 == 02:00Z
