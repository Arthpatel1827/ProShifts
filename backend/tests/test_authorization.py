"""Cross-tenant and role checks: changing an id in the request must never expose data."""
from datetime import timedelta

from tests.conftest import next_monday


def test_team_status_requires_membership_at_location(client, world):
    assert client.get(f"/time-entries/team-status?location_id={world.loc_a}",
                      headers=world.headers(world.staff_a)).status_code == 200
    assert client.get(f"/time-entries/team-status?location_id={world.loc_a}",
                      headers=world.headers(world.owner_b)).status_code == 403


def test_analytics_checks_role_at_requested_location(client, world):
    # owner_b manages *a* location — but not this one.
    assert client.get(f"/admin/analytics/?location_id={world.loc_a}",
                      headers=world.headers(world.owner_b)).status_code == 403
    assert client.get(f"/admin/analytics/?location_id={world.loc_a}",
                      headers=world.headers(world.staff_a)).status_code == 403
    res = client.get(f"/admin/analytics/?location_id={world.loc_a}&period=week",
                     headers=world.headers(world.manager_a))
    assert res.status_code == 200 and "summary" in res.get_json()


def test_staff_list_is_manager_only_and_location_scoped(client, world):
    assert client.get(f"/admin/staff?location_id={world.loc_a}", headers=world.headers(world.staff_a)).status_code == 403
    assert client.get(f"/admin/staff?location_id={world.loc_a}", headers=world.headers(world.owner_b)).status_code == 403
    staff = client.get(f"/admin/staff?location_id={world.loc_a}", headers=world.headers(world.manager_a)).get_json()["staff"]
    assert {s["email"] for s in staff} == {"owner@a.test", "manager@a.test", "sam@a.test", "ria@a.test"}


def test_employee_profile_is_company_scoped(client, world):
    assert client.get(f"/admin/staff/{world.owner_b}/profile", headers=world.headers(world.manager_a)).status_code == 404
    assert client.put(f"/admin/staff/{world.owner_b}/profile", headers=world.headers(world.manager_a),
                      json={"hourly_rate": 1}).status_code == 404
    assert client.get(f"/admin/staff/{world.staff_a}/profile", headers=world.headers(world.staff_a2)).status_code == 403


def test_manager_cannot_edit_owner_or_deactivate_self(client, world):
    h = world.headers(world.manager_a)
    assert client.put(f"/admin/staff/{world.owner_a}/profile", headers=h, json={"status": "inactive"}).status_code == 403
    assert client.put(f"/admin/staff/{world.manager_a}/profile", headers=h, json={"status": "inactive"}).status_code == 400
    ok = client.put(f"/admin/staff/{world.staff_a}/profile", headers=h, json={"hourly_rate": 22.5, "phone": "416-555-0100"})
    assert ok.status_code == 200 and ok.get_json()["profile"]["hourly_rate"] == 22.5


def test_staff_cannot_edit_location(client, world):
    assert client.put(f"/admin/locations/{world.loc_a}", headers=world.headers(world.staff_a),
                      json={"loc_name": "Hacked"}).status_code == 403
    assert client.put(f"/admin/locations/{world.loc_b}", headers=world.headers(world.manager_a),
                      json={"loc_name": "Hacked"}).status_code == 404


def test_pending_lists_require_manager_at_location(client, world):
    for path in (f"/swaps/pending-manager?location_id={world.loc_a}", f"/drops/pending?location_id={world.loc_a}"):
        assert client.get(path, headers=world.headers(world.owner_b)).status_code == 403
        assert client.get(path, headers=world.headers(world.staff_a)).status_code == 403
        assert client.get(path, headers=world.headers(world.manager_a)).status_code == 200
    assert client.get("/time-off/pending", headers=world.headers(world.staff_a)).status_code == 403


def test_drop_request_flow_includes_employee_and_frees_shift(client, world):
    start = next_monday().replace(hour=9)
    sid = world.shift(world.loc_a, start, assign=[world.staff_a], status="published")
    created = client.post("/drops/", headers=world.headers(world.staff_a), json={"shift_id": sid, "reason": "Exam"})
    assert created.status_code in (200, 201)
    pending = client.get(f"/drops/pending?location_id={world.loc_a}", headers=world.headers(world.manager_a)).get_json()["drops"]
    assert pending[0]["employee"]["name"] == "Sam Staff"
    drop_id = pending[0]["drop_id"]
    # Another company's owner can't decide it.
    assert client.post(f"/drops/{drop_id}/decide", headers=world.headers(world.owner_b), json={"approve": True}).status_code == 403
    assert client.post(f"/drops/{drop_id}/decide", headers=world.headers(world.manager_a), json={"approve": True}).status_code == 200
    shift = client.get(f"/shifts/{sid}", headers=world.headers(world.manager_a)).get_json()["shift"]
    assert shift["assignments"] == []


def test_time_off_pending_includes_employee_name(client, world):
    day = (next_monday() + timedelta(days=14)).date().isoformat()
    res = client.post("/time-off/", headers=world.headers(world.staff_a),
                      json={"start_date": day, "end_date": day, "request_type": "vacation"})
    assert res.status_code in (200, 201)
    pending = client.get("/time-off/pending", headers=world.headers(world.owner_a)).get_json()["requests"]
    assert pending[0]["employee"]["name"] == "Sam Staff"
    # owner_b is an owner, but of a different company.
    rid = pending[0]["request_id"]
    assert client.post(f"/time-off/{rid}/decide", headers=world.headers(world.owner_b), json={"approve": True}).status_code == 403
