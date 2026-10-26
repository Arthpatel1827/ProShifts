# tests/test_swaps.py
"""Shift swaps are validated on the RESULTING schedule, at request, accept and approval."""
from datetime import time, timedelta

from extensions import db
from models import Availability, Employment, ShiftAssignment, ShiftSwap, TimeOffRequest
from tests.conftest import next_monday

MON = next_monday()
TUE, WED = MON + timedelta(days=1), MON + timedelta(days=2)


def users_on(app, sid):
    with app.app_context():
        return sorted(a.user_id for a in ShiftAssignment.query.filter_by(shift_id=sid).all())


def setup_bug(world):
    """ABC (Sam) works Tue 9–5. Priya (Ria) works Tue 1–9 PM and Wed 10–6."""
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), hours=8, assign=[world.staff_a], status="published")
    ria_tue = world.shift(world.loc_a, TUE + timedelta(hours=13), hours=8, assign=[world.staff_a2], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), hours=8, assign=[world.staff_a2], status="published")
    return sam_tue, ria_tue, ria_wed


def targeted(client, world, give, take, who=None, to=None):
    return client.post("/swaps/targeted", headers=world.headers(who or world.staff_a), json={
        "shift_id": give, "receiving_user_id": to or world.staff_a2, "offered_shift_id": take,
    })


def accept(client, world, swap_id, who=None):
    return client.post(f"/swaps/{swap_id}/accept", headers=world.headers(who or world.staff_a2))


def decide(client, world, swap_id, approve=True, **extra):
    return client.post(f"/swaps/{swap_id}/decide", headers=world.headers(world.manager_a),
                       json={"approve": approve, **extra})


def test_valid_swap_is_applied(app, client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), assign=[world.staff_a2], status="published")
    res = targeted(client, world, sam_tue, ria_wed)
    assert res.status_code == 201, res.get_json()
    sid = res.get_json()["swap"]["swap_id"]
    assert accept(client, world, sid).status_code == 200
    res = decide(client, world, sid)
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["validation"]["ok"] is True
    assert users_on(app, sam_tue) == [world.staff_a2] and users_on(app, ria_wed) == [world.staff_a]


def test_swap_that_creates_overlap_is_refused_at_request(app, client, world):
    # The reported bug: Priya would end up with two overlapping Tuesday shifts.
    sam_tue, ria_tue, ria_wed = setup_bug(world)
    res = targeted(client, world, sam_tue, ria_wed)
    assert res.status_code == 409, res.get_json()
    body = res.get_json()
    assert body["code"] == "SWAP_CONFLICT"
    assert "Ria Barista already has a shift that overlaps" in body["error"]
    rec = body["validation"]["receiver"]
    assert rec["errors"][0]["code"] == "OVERLAP" and rec["errors"][0]["shift_id"] == ria_tue
    with app.app_context():
        assert ShiftSwap.query.count() == 0  # nothing was saved


def test_preview_shows_the_conflict_before_submitting(client, world):
    sam_tue, ria_tue, ria_wed = setup_bug(world)
    res = client.post("/swaps/preview", headers=world.headers(world.staff_a), json={
        "shift_id": sam_tue, "receiving_user_id": world.staff_a2, "offered_shift_id": ria_wed,
    })
    assert res.status_code == 200
    v = res.get_json()["validation"]
    assert v["ok"] is False and v["receiver"]["receives"]["shift_id"] == sam_tue
    assert v["requester"]["ok"] is True  # Sam taking Wednesday is fine


def test_preview_only_for_your_own_shift(client, world):
    sam_tue, _, ria_wed = setup_bug(world)
    # The manager isn't on Sam's shift, so can't preview "giving" it.
    res = client.post("/swaps/preview", headers=world.headers(world.manager_a), json={
        "shift_id": sam_tue, "receiving_user_id": world.staff_a2, "offered_shift_id": ria_wed,
    })
    assert res.status_code == 400


def test_schedule_change_after_request_blocks_approval(app, client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), assign=[world.staff_a2], status="published")
    sid = targeted(client, world, sam_tue, ria_wed).get_json()["swap"]["swap_id"]
    assert accept(client, world, sid).status_code == 200
    # Afterwards the manager gives Ria another Tuesday shift that overlaps Sam's.
    later = world.shift(world.loc_a, TUE + timedelta(hours=12), hours=6, status="published")
    assert client.post(f"/shifts/{later}/assign", headers=world.headers(world.manager_a),
                       json={"user_id": world.staff_a2}).status_code == 200
    res = decide(client, world, sid)
    assert res.status_code == 409 and res.get_json()["code"] == "SWAP_CONFLICT"
    # Nothing moved, the swap is still waiting.
    assert users_on(app, sam_tue) == [world.staff_a] and users_on(app, ria_wed) == [world.staff_a2]
    with app.app_context():
        assert ShiftSwap.query.get(sid).status == "accepted"


def test_accept_revalidates(app, client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), assign=[world.staff_a2], status="published")
    sid = targeted(client, world, sam_tue, ria_wed).get_json()["swap"]["swap_id"]
    world.shift(world.loc_a, TUE + timedelta(hours=8), hours=4, assign=[world.staff_a2], status="draft")
    res = accept(client, world, sid)
    assert res.status_code == 409 and "overlaps" in res.get_json()["error"]


def test_time_off_conflict_refused(app, client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), assign=[world.staff_a2], status="published")
    with app.app_context():
        db.session.add(TimeOffRequest(user_id=world.staff_a2, comp_id=world.comp_a, start_date=TUE.date(),
                                      end_date=TUE.date(), status="approved"))
        db.session.commit()
    res = targeted(client, world, sam_tue, ria_wed)
    assert res.status_code == 409 and "approved time off" in res.get_json()["error"]


def test_availability_needs_manager_override(app, client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), assign=[world.staff_a2], status="published")
    with app.app_context():
        emp = Employment.query.filter_by(user_id=world.staff_a2).first()
        db.session.add(Availability(emp_id=emp.emp_id, day_of_week="tue", start_time=time(17), end_time=time(23)))
        db.session.add(Availability(emp_id=emp.emp_id, day_of_week="wed", start_time=time(8), end_time=time(20)))
        db.session.commit()
    res = targeted(client, world, sam_tue, ria_wed)
    assert res.status_code == 201  # availability alone doesn't block the request…
    sid = res.get_json()["swap"]["swap_id"]
    assert accept(client, world, sid).status_code == 200
    res = decide(client, world, sid)
    assert res.status_code == 409 and res.get_json()["code"] == "OUTSIDE_AVAILABILITY"  # …the manager decides
    assert users_on(app, sam_tue) == [world.staff_a]
    res = decide(client, world, sid, allow_outside_availability=True)
    assert res.status_code == 200 and users_on(app, sam_tue) == [world.staff_a2]


def test_overtime_is_reported(app, client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), hours=11, assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), hours=4, assign=[world.staff_a2], status="published")
    for d in (3, 4, 5):  # Ria already has 3 × 10 h
        world.shift(world.loc_a, MON + timedelta(days=d, hours=8), hours=10, assign=[world.staff_a2], status="published")
    res = client.post("/swaps/preview", headers=world.headers(world.staff_a), json={
        "shift_id": sam_tue, "receiving_user_id": world.staff_a2, "offered_shift_id": ria_wed,
    })
    v = res.get_json()["validation"]
    assert v["ok"] is True and any("Overtime" in w for w in v["warnings"])
    assert v["receiver"]["week_hours_after"] == 41.0


def test_open_swap_offer_that_conflicts_is_refused(client, world):
    sam_tue, ria_tue, ria_wed = setup_bug(world)
    res = client.post("/swaps/open", headers=world.headers(world.staff_a), json={"shift_id": sam_tue})
    sid = res.get_json()["swap"]["swap_id"]
    res = client.post(f"/swaps/{sid}/offer", headers=world.headers(world.staff_a2), json={"offered_shift_id": ria_wed})
    assert res.status_code == 409 and res.get_json()["code"] == "SWAP_CONFLICT"


def test_pending_manager_list_includes_validation(client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    ria_wed = world.shift(world.loc_a, WED + timedelta(hours=10), assign=[world.staff_a2], status="published")
    sid = targeted(client, world, sam_tue, ria_wed).get_json()["swap"]["swap_id"]
    accept(client, world, sid)
    res = client.get(f"/swaps/pending-manager?location_id={world.loc_a}", headers=world.headers(world.manager_a))
    swap = res.get_json()["swaps"][0]
    assert swap["validation"]["ok"] is True and swap["conflicts"] == {"requester": [], "receiver": []}


def test_colleague_shifts_are_tenant_scoped(client, world):
    world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    res = client.get(f"/swaps/colleague-shifts/{world.staff_a}", headers=world.headers(world.owner_b))
    assert res.get_json()["shifts"] == []
    res = client.get(f"/swaps/colleague-shifts/{world.staff_a}", headers=world.headers(world.staff_a2))
    assert len(res.get_json()["shifts"]) == 1


def test_cannot_swap_with_another_company(client, world):
    sam_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), assign=[world.staff_a], status="published")
    b_shift = world.shift(world.loc_b, WED + timedelta(hours=9), assign=[world.owner_b], status="published")
    res = targeted(client, world, sam_tue, b_shift, to=world.owner_b)
    assert res.status_code == 400


# ── The exact production bug, with the same people ──────────────────────────
def _abc_priya(app, world):
    with app.app_context():
        abc = world._user("abc@a.test", "ABC", world.comp_a, world.loc_a, world.role_barista)
        priya = world._user("priya@a.test", "Priya", world.comp_a, world.loc_a, world.role_barista)
        db.session.commit()
    return abc, priya


def test_abc_priya_invalid_swap_cannot_be_submitted(app, client, world):
    abc, priya = _abc_priya(app, world)
    abc_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), hours=8, assign=[abc], status="published")
    priya_tue = world.shift(world.loc_a, TUE + timedelta(hours=13), hours=8, assign=[priya], status="published")
    priya_wed = world.shift(world.loc_a, WED + timedelta(hours=10), hours=8, assign=[priya], status="published")
    # What the app shows before sending:
    prev = client.post("/swaps/preview", headers=world.headers(abc), json={
        "shift_id": abc_tue, "receiving_user_id": priya, "offered_shift_id": priya_wed}).get_json()["validation"]
    assert prev["ok"] is False
    assert any("Priya already has a shift that overlaps this time" in e and "Tue" in e for e in prev["errors"])
    assert prev["receiver"]["errors"][0]["shift_id"] == priya_tue
    # Sending is refused, and nothing is saved.
    res = client.post("/swaps/targeted", headers=world.headers(abc), json={
        "shift_id": abc_tue, "receiving_user_id": priya, "offered_shift_id": priya_wed})
    assert res.status_code == 409 and res.get_json()["code"] == "SWAP_CONFLICT"
    with app.app_context():
        assert ShiftSwap.query.count() == 0
    assert users_on(app, abc_tue) == [abc] and users_on(app, priya_wed) == [priya]


def test_abc_priya_schedule_changes_after_request_manager_cannot_approve(app, client, world):
    abc, priya = _abc_priya(app, world)
    abc_tue = world.shift(world.loc_a, TUE + timedelta(hours=9), hours=8, assign=[abc], status="published")
    priya_wed = world.shift(world.loc_a, WED + timedelta(hours=10), hours=8, assign=[priya], status="published")
    sid = client.post("/swaps/targeted", headers=world.headers(abc), json={
        "shift_id": abc_tue, "receiving_user_id": priya, "offered_shift_id": priya_wed}).get_json()["swap"]["swap_id"]
    assert client.post(f"/swaps/{sid}/accept", headers=world.headers(priya)).status_code == 200
    # Later the manager gives Priya another Tuesday shift that overlaps ABC's.
    new_tue = world.shift(world.loc_a, TUE + timedelta(hours=13), hours=8, status="published")
    assert client.post(f"/shifts/{new_tue}/assign", headers=world.headers(world.manager_a), json={"user_id": priya}).status_code == 200
    # The manager's list shows the conflict and the swap can't be approved.
    pending = client.get(f"/swaps/pending-manager?location_id={world.loc_a}", headers=world.headers(world.manager_a)).get_json()["swaps"]
    v = pending[0]["validation"]
    assert v["ok"] is False and any("Priya already has a shift that overlaps" in e for e in v["errors"])
    res = client.post(f"/swaps/{sid}/decide", headers=world.headers(world.manager_a), json={"approve": True})
    assert res.status_code == 409 and res.get_json()["code"] == "SWAP_CONFLICT"
    # Even "approve anyway" for availability can't push a hard conflict through.
    res = client.post(f"/swaps/{sid}/decide", headers=world.headers(world.manager_a), json={"approve": True, "allow_outside_availability": True})
    assert res.status_code == 409
    assert users_on(app, abc_tue) == [abc] and users_on(app, priya_wed) == [priya]
    with app.app_context():
        assert ShiftSwap.query.get(sid).status == "accepted" and ShiftSwap.query.get(sid).manager_approved is None
