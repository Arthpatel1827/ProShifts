# tests/test_kiosk.py
"""Personal clock-in PINs and the punch-in tablet."""
from datetime import datetime, timedelta, timezone

from extensions import db
from models import Company, Employment, KioskDevice, TimeEntry


def set_pin(client, world, uid, pin="4827", confirm=None):
    return client.put("/kiosk/pin", headers=world.headers(uid), json={"pin": pin, "confirm": confirm or pin})


def tablet(client, world, who=None, loc=None):
    res = client.post("/kiosk/devices", headers=world.headers(who or world.manager_a),
                      json={"location_id": loc or world.loc_a, "name": "Front counter"})
    assert res.status_code == 201, res.get_json()
    return res.get_json()["token"]


def punch(client, token, pin, action="auto"):
    return client.post("/kiosk/punch", headers={"X-Kiosk-Token": token}, json={"pin": pin, "action": action})


def shift_now(world, uid, minutes_from_now=5, hours=8, loc=None):
    start = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=minutes_from_now)
    return world.shift(loc or world.loc_a, start, hours=hours, assign=[uid], status="published")


# ── PIN ──────────────────────────────────────────────────────────────────────
def test_create_and_change_pin_stored_hashed(app, client, world):
    res = set_pin(client, world, world.staff_a)
    assert res.status_code == 200 and res.get_json()["is_set"] is True
    with app.app_context():
        h = Employment.query.filter_by(user_id=world.staff_a).first().kiosk_pin_hash
    assert h and "4827" not in h and len(h) == 64
    assert set_pin(client, world, world.staff_a, "5928").status_code == 200
    with app.app_context():
        assert Employment.query.filter_by(user_id=world.staff_a).first().kiosk_pin_hash != h


def test_pin_rules(client, world):
    assert set_pin(client, world, world.staff_a, "123").status_code == 400
    assert set_pin(client, world, world.staff_a, "12a4").status_code == 400
    assert set_pin(client, world, world.staff_a, "4827", "4828").status_code == 400
    assert set_pin(client, world, world.staff_a, "1234").status_code == 400  # too easy
    assert set_pin(client, world, world.staff_a, "4827").status_code == 200
    taken = set_pin(client, world, world.staff_a2, "4827")
    assert taken.status_code == 400 and "isn't available" in taken.get_json()["error"]
    assert "Sam" not in taken.get_json()["error"]  # never says whose
    # The same PIN is fine in another company.
    assert set_pin(client, world, world.owner_b, "4827").status_code == 200


def test_pin_never_exposed_to_managers(app, client, world):
    set_pin(client, world, world.staff_a)
    for path in (f"/admin/staff/{world.staff_a}/profile", f"/admin/staff?location_id={world.loc_a}"):
        body = client.get(path, headers=world.headers(world.manager_a)).get_data(as_text=True)
        assert "4827" not in body and "kiosk_pin_hash" not in body


def test_manager_resets_pin(app, client, world):
    set_pin(client, world, world.staff_a)
    assert client.delete(f"/kiosk/pin/{world.staff_a}", headers=world.headers(world.staff_a2)).status_code == 403
    assert client.delete(f"/kiosk/pin/{world.staff_a}", headers=world.headers(world.owner_b)).status_code == 404
    assert client.delete(f"/kiosk/pin/{world.staff_a}", headers=world.headers(world.manager_a)).status_code == 200
    assert client.get("/kiosk/pin", headers=world.headers(world.staff_a)).get_json()["is_set"] is False


# ── tablet ───────────────────────────────────────────────────────────────────
def test_only_managers_set_up_tablets(client, world):
    assert client.post("/kiosk/devices", headers=world.headers(world.staff_a), json={"location_id": world.loc_a}).status_code == 403
    assert client.post("/kiosk/devices", headers=world.headers(world.owner_b), json={"location_id": world.loc_a}).status_code == 403
    token = tablet(client, world)
    assert client.get("/kiosk/session", headers={"X-Kiosk-Token": token}).get_json()["location"] == "Downtown"
    assert client.get("/kiosk/session", headers={"X-Kiosk-Token": "nope"}).status_code == 401


def test_successful_clock_in_then_choose_then_out(app, client, world):
    shift_now(world, world.staff_a, minutes_from_now=-5, hours=0.25)
    set_pin(client, world, world.staff_a)
    token = tablet(client, world)
    res = punch(client, token, "4827")
    assert res.status_code == 200, res.get_json()
    body = res.get_json()
    assert body["status"] == "clocked_in" and body["first_name"] == "Sam" and body["shift"]["start"]
    assert set(body) == {"status", "first_name", "shift"}  # nothing else on a shared screen
    with app.app_context():
        e = TimeEntry.query.filter_by(user_id=world.staff_a).first()
        assert e and e.shift_id and e.clock_out is None
    # Second punch: choose break or clock out.
    res = punch(client, token, "4827")
    assert res.get_json() == {"status": "choose", "first_name": "Sam", "options": ["break_start", "clock_out"]}
    assert punch(client, token, "4827", "break_start").get_json()["status"] == "break_started"
    assert punch(client, token, "4827").get_json()["status"] == "break_ended"  # auto ends the break
    # 15-minute shift: inside the clock-out window.
    assert punch(client, token, "4827", "clock_out").get_json()["status"] == "clocked_out"


def test_invalid_pin_generic_and_lockout(app, client, world):
    shift_now(world, world.staff_a)
    set_pin(client, world, world.staff_a)
    token = tablet(client, world)
    for _ in range(4):
        res = punch(client, token, "9581")
        assert res.status_code == 400 and res.get_json() == {"error": "Invalid PIN.", "code": "INVALID_PIN"}
    assert punch(client, token, "9581").status_code == 400  # 5th wrong → locks
    res = punch(client, token, "4827")  # even the right PIN waits now
    assert res.status_code == 423
    with app.app_context():
        assert KioskDevice.query.first().locked_until is not None


def test_inactive_and_other_location_and_company_get_invalid_pin(app, client, world):
    set_pin(client, world, world.staff_a)
    set_pin(client, world, world.owner_b, "4827")
    token = tablet(client, world)
    # Inactive employee: same generic answer.
    with app.app_context():
        Employment.query.filter_by(user_id=world.staff_a).first().status = "inactive"
        db.session.commit()
    assert punch(client, token, "4827").get_json()["error"] == "Invalid PIN."
    # A tablet at another location of the same company doesn't know staff from here.
    with app.app_context():
        Employment.query.filter_by(user_id=world.staff_a).first().status = "active"
        db.session.commit()
    uptown = client.post("/kiosk/devices", headers=world.headers(world.owner_a), json={"location_id": world.loc_a2})
    assert uptown.status_code == 403  # owner isn't employed at Uptown in this world
    b_token = tablet(client, world, who=world.owner_b, loc=world.loc_b)
    assert punch(client, b_token, "5928").get_json()["error"] == "Invalid PIN."


def test_cross_company_pin_does_not_unlock(app, client, world):
    set_pin(client, world, world.owner_b, "4827")  # company B
    shift_now(world, world.owner_b, loc=world.loc_b)
    token_a = tablet(client, world)  # company A tablet
    assert punch(client, token_a, "4827").get_json()["error"] == "Invalid PIN."


def test_outside_clock_in_window(client, world):
    shift_now(world, world.staff_a, minutes_from_now=120)
    set_pin(client, world, world.staff_a)
    token = tablet(client, world)
    res = punch(client, token, "4827")
    assert res.status_code == 400 and "Too early" in res.get_json()["error"]


def test_no_shift_today(client, world):
    set_pin(client, world, world.staff_a)
    token = tablet(client, world)
    res = punch(client, token, "4827")
    assert res.status_code == 400 and "not scheduled" in res.get_json()["error"]


def test_manager_only_mode_blocks_tablet(app, client, world):
    with app.app_context():
        Company.query.get(world.comp_a).clock_in_method = "manager_only"
        db.session.commit()
    shift_now(world, world.staff_a)
    set_pin(client, world, world.staff_a)
    token = tablet(client, world)
    assert "managed by your manager" in punch(client, token, "4827").get_json()["error"]


def test_tablet_skips_phone_gps_but_kiosk_mode_blocks_phone(app, client, world):
    # GPS mode with store coordinates: the tablet is the proof of presence.
    with app.app_context():
        from models import Location
        loc = Location.query.get(world.loc_a)
        loc.loc_lat, loc.loc_lng = 43.65, -79.38
        db.session.commit()
    sid = shift_now(world, world.staff_a)
    set_pin(client, world, world.staff_a)
    token = tablet(client, world)
    assert punch(client, token, "4827").get_json()["status"] == "clocked_in"
    # Tablet-only mode: phones can't clock in.
    client.put("/time-entries/settings", headers=world.headers(world.manager_a), json={"clock_in_method": "kiosk_pin"})
    res = client.post("/time-entries/clock-in", headers=world.headers(world.staff_a2), json={"latitude": 43.65, "longitude": -79.38})
    assert res.status_code == 400 and "punch-in tablet" in res.get_json()["error"]
    assert sid


def test_revoked_tablet_stops_working(client, world):
    token = tablet(client, world)
    dev = client.get(f"/kiosk/devices?location_id={world.loc_a}", headers=world.headers(world.manager_a)).get_json()["devices"][0]
    assert client.delete(f"/kiosk/devices/{dev['device_id']}", headers=world.headers(world.manager_a)).status_code == 200
    assert punch(client, token, "4827").status_code == 401


def test_punch_rate_limited(client, world):
    from extensions import limiter
    token = tablet(client, world)
    limiter.enabled = True
    try:
        limiter.reset()
        codes = [punch(client, token, f"{n:04d}").status_code for n in range(14)]
    finally:
        limiter.enabled = False
    assert 429 in codes and codes.count(429) == 2  # 12 per minute per tablet


def test_pin_never_logged(app, client, world, caplog):
    import logging
    caplog.set_level(logging.DEBUG)
    shift_now(world, world.staff_a)
    set_pin(client, world, world.staff_a, "4827")
    token = tablet(client, world)
    punch(client, token, "4827")
    punch(client, token, "6153")
    assert "4827" not in caplog.text and "6153" not in caplog.text


def test_missing_or_weak_secret_is_a_clear_config_error(app, client, world, caplog):
    import logging
    caplog.set_level(logging.DEBUG)
    token = tablet(client, world)
    good = app.config["KIOSK_PIN_SECRET"]
    try:
        for bad in (None, "", "replace-with-a-long-random-string", "short", app.config["JWT_SECRET_KEY"]):
            app.config["KIOSK_PIN_SECRET"] = bad
            res = set_pin(client, world, world.staff_a)
            assert res.status_code == 503 and res.get_json()["code"] == "KIOSK_NOT_CONFIGURED", (bad, res.get_json())
            assert "KIOSK_PIN_SECRET" in res.get_json()["error"]
            assert punch(client, token, "4827").status_code == 503
            if bad:
                assert bad not in res.get_data(as_text=True)  # never echoes the value
    finally:
        app.config["KIOSK_PIN_SECRET"] = good
    assert good not in caplog.text
    assert set_pin(client, world, world.staff_a).status_code == 200


def test_pin_hash_does_not_depend_on_jwt_secret(app, client, world):
    set_pin(client, world, world.staff_a)
    with app.app_context():
        before = Employment.query.filter_by(user_id=world.staff_a).first().kiosk_pin_hash
        from services.kiosk_service import pin_hash
        old_jwt = app.config["JWT_SECRET_KEY"]
        app.config["JWT_SECRET_KEY"] = "a-rotated-jwt-secret-that-is-long-enough-0000"
        try:
            assert pin_hash(world.comp_a, "4827") == before  # JWT rotation leaves PINs alone
        finally:
            app.config["JWT_SECRET_KEY"] = old_jwt


def test_zero_pin_is_too_easy(client, world):
    res = set_pin(client, world, world.staff_a, "0000")
    assert res.status_code == 400 and "too easy" in res.get_json()["error"]
