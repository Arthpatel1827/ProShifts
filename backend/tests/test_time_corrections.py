# tests/test_time_corrections.py
"""Manager corrections to worked time: permission-checked, audited, never silent."""
from datetime import timedelta, timezone

from extensions import db
from models import BreakEntry, Company, Role, Employment, TimeEntry, TimeEntryAudit
from tests.conftest import next_monday

PAST_MON = (next_monday() - timedelta(days=14)).replace(tzinfo=timezone.utc)


def entry(app, uid, start, hours=8, sid=None, breaks=()):
    with app.app_context():
        e = TimeEntry(user_id=uid, shift_id=sid, clock_in=start, clock_out=start + timedelta(hours=hours),
                      total_minutes=int(hours * 60))
        db.session.add(e)
        db.session.flush()
        for bs, mins in breaks:
            db.session.add(BreakEntry(entry_id=e.entry_id, break_start=bs, break_end=bs + timedelta(minutes=mins), duration_minutes=mins))
        db.session.commit()
        return e.entry_id


def naive(dt):
    return dt.replace(tzinfo=None).isoformat()


def patch(client, world, eid, who=None, **body):
    return client.patch(f"/time-entries/{eid}", headers=world.headers(who or world.manager_a), json=body)


def test_manager_corrects_clock_in_and_out_with_history(app, client, world):
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9, minutes=7))
    res = patch(client, world, eid, clock_in=naive(PAST_MON + timedelta(hours=9)), clock_out=naive(PAST_MON + timedelta(hours=17, minutes=30)),
                reason="Forgot to clock out; confirmed with Sam")
    assert res.status_code == 200, res.get_json()
    e = res.get_json()["entry"]
    assert e["total_minutes"] == 510 and e["corrected_by"] == world.manager_a and e["corrected_at"]
    hist = client.get(f"/time-entries/{eid}/audit", headers=world.headers(world.manager_a)).get_json()["history"]
    assert [h["action"] for h in hist] == ["clock_in", "clock_out"]
    assert hist[0]["old_value"].startswith(naive(PAST_MON + timedelta(hours=9, minutes=7))[:16])  # original kept
    assert hist[0]["changed_by_name"] == "Max Manager" and "Forgot" in hist[0]["reason"]


def test_reason_is_required(app, client, world):
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9))
    res = patch(client, world, eid, clock_out=naive(PAST_MON + timedelta(hours=18)))
    assert res.status_code == 400 and "reason" in res.get_json()["error"]


def test_staff_cannot_correct_even_their_own(app, client, world):
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9))
    assert patch(client, world, eid, who=world.staff_a, clock_out=naive(PAST_MON + timedelta(hours=20)), reason="more pay").status_code == 403
    with app.app_context():
        assert TimeEntryAudit.query.count() == 0


def test_manager_cannot_correct_own_entry_owner_can(app, client, world):
    eid = entry(app, world.manager_a, PAST_MON + timedelta(hours=9))
    assert patch(client, world, eid, clock_out=naive(PAST_MON + timedelta(hours=19)), reason="stayed late").status_code == 403
    assert patch(client, world, eid, who=world.owner_a, clock_out=naive(PAST_MON + timedelta(hours=19)), reason="stayed late").status_code == 200


def test_supervisor_and_other_company_blocked(app, client, world):
    with app.app_context():
        sup = Role(name="Supervisor", location_id=world.loc_a, is_system=True)
        db.session.add(sup); db.session.flush()
        Employment.query.filter_by(user_id=world.staff_a2).first().role_id = sup.role_id
        db.session.commit()
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9))
    assert patch(client, world, eid, who=world.staff_a2, clock_out=naive(PAST_MON + timedelta(hours=18)), reason="fix it").status_code == 403
    assert patch(client, world, eid, who=world.owner_b, clock_out=naive(PAST_MON + timedelta(hours=18)), reason="fix it").status_code == 403
    # Supervisors may read the history, not change it.
    assert client.get(f"/time-entries/{eid}/audit", headers=world.headers(world.staff_a2)).status_code == 200


def test_invalid_times(app, client, world):
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9))
    assert patch(client, world, eid, clock_out=naive(PAST_MON + timedelta(hours=8)), reason="oops").status_code == 400
    assert patch(client, world, eid, clock_out=naive(PAST_MON + timedelta(hours=40)), reason="oops").status_code == 400
    other = entry(app, world.staff_a, PAST_MON + timedelta(hours=18))
    res = patch(client, world, eid, clock_out=naive(PAST_MON + timedelta(hours=19)), reason="stayed")
    assert res.status_code == 400 and "overlap" in res.get_json()["error"]
    assert other


def test_breaks_add_change_remove(app, client, world):
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9), breaks=[(PAST_MON + timedelta(hours=12), 30)])
    h = world.headers(world.manager_a)
    res = client.post(f"/time-entries/{eid}/breaks", headers=h, json={
        "break_start": naive(PAST_MON + timedelta(hours=15)), "break_end": naive(PAST_MON + timedelta(hours=15, minutes=15)),
        "reason": "Took a second break, not punched"})
    assert res.status_code == 201, res.get_json()
    e = res.get_json()["entry"]
    assert e["total_minutes"] == 480 - 45 and len(e["breaks"]) == 2
    first = e["breaks"][0]["break_id"]
    res = client.patch(f"/time-entries/breaks/{first}", headers=h, json={
        "break_end": naive(PAST_MON + timedelta(hours=12, minutes=45)), "reason": "Break ran long"})
    assert res.status_code == 200 and res.get_json()["entry"]["total_minutes"] == 480 - 60
    res = client.delete(f"/time-entries/breaks/{first}", headers=h, json={"reason": "Didn't take it"})
    assert res.status_code == 200 and res.get_json()["entry"]["total_minutes"] == 480 - 15
    hist = client.get(f"/time-entries/{eid}/audit", headers=h).get_json()["history"]
    assert [x["action"] for x in hist] == ["break_added", "break_changed", "break_removed"]
    # Outside the worked time / overlapping are refused.
    bad = client.post(f"/time-entries/{eid}/breaks", headers=h, json={
        "break_start": naive(PAST_MON + timedelta(hours=8)), "break_end": naive(PAST_MON + timedelta(hours=8, minutes=30)), "reason": "x x"})
    assert bad.status_code == 400


def test_paid_breaks_not_deducted(app, client, world):
    with app.app_context():
        Company.query.get(world.comp_a).paid_break = True
        db.session.commit()
    eid = entry(app, world.staff_a, PAST_MON + timedelta(hours=9))
    res = client.post(f"/time-entries/{eid}/breaks", headers=world.headers(world.manager_a), json={
        "break_start": naive(PAST_MON + timedelta(hours=12)), "break_end": naive(PAST_MON + timedelta(hours=12, minutes=30)), "reason": "lunch"})
    assert res.get_json()["entry"]["total_minutes"] == 480


def test_list_for_location(app, client, world):
    entry(app, world.staff_a, PAST_MON + timedelta(hours=9))
    entry(app, world.owner_b, PAST_MON + timedelta(hours=9))
    res = client.get(f"/time-entries/manage?location_id={world.loc_a}&week_start={PAST_MON.date().isoformat()}",
                     headers=world.headers(world.manager_a))
    entries = res.get_json()["entries"]
    assert [e["employee_name"] for e in entries] == ["Sam Staff"]  # no other company's people
    assert client.get(f"/time-entries/manage?location_id={world.loc_b}&week_start={PAST_MON.date().isoformat()}",
                      headers=world.headers(world.manager_a)).status_code == 403
