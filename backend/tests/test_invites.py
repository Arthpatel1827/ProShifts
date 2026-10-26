# tests/test_invites.py
"""Invite delivery reporting and "Resend invite"."""
import pytest

from extensions import db
from models import Employment


def invite(client, world, email="new@a.test", position="Barista", who=None):
    return client.post("/onboarding/invite", headers=world.headers(who or world.manager_a),
                       json={"email": email, "location_id": world.loc_a, "position": position})


def resend(client, world, user_id, who=None, location_id=None):
    return client.post("/onboarding/invite/resend", headers=world.headers(who or world.manager_a),
                       json={"user_id": user_id, "location_id": location_id or world.loc_a})


def login(client, email, password):
    return client.post("/auth/login", json={"email": email, "password": password}).status_code


@pytest.fixture
def mail_ok(monkeypatch):
    monkeypatch.setattr("services.onboarding_service.send_onboarding_email", lambda **kw: True)


@pytest.fixture
def mail_broken(app, monkeypatch):
    """Sending is enabled but the mail server rejects us (e.g. bad Gmail credentials)."""
    from extensions import mail

    def boom(msg):
        raise RuntimeError("535 Username and Password not accepted")
    app.config["EMAIL_SENDING_ENABLED"] = True
    monkeypatch.setattr(mail, "send", boom)
    yield
    app.config["EMAIL_SENDING_ENABLED"] = False


def test_invite_reports_email_sent_and_hides_password(client, world, mail_ok):
    body = invite(client, world).get_json()
    assert body["result"]["email_sent"] is True
    assert "temp_password" not in body["result"]


def test_invite_reports_failed_email_and_returns_usable_password(client, world, mail_broken):
    res = invite(client, world)
    assert res.status_code == 200
    result = res.get_json()["result"]
    assert result["email_sent"] is False and result["temp_password"]
    assert "not sent" in res.get_json()["message"]
    assert login(client, "new@a.test", result["temp_password"]) == 200


def test_duplicate_invite_points_to_resend(client, world):
    invite(client, world)
    again = invite(client, world)
    assert again.status_code == 400 and "Resend invite" in again.get_json()["error"]


def test_resend_issues_new_working_password(client, world, mail_broken):
    first = invite(client, world).get_json()["result"]
    res = resend(client, world, first["user_id"])
    assert res.status_code == 200, res.get_json()
    result = res.get_json()["result"]
    assert result["email_sent"] is False and result["temp_password"] != first["temp_password"]
    assert login(client, "new@a.test", result["temp_password"]) == 200
    assert login(client, "new@a.test", first["temp_password"]) == 401  # old one stops working


def test_resend_when_email_works_returns_no_password(client, world, mail_ok):
    uid = invite(client, world).get_json()["result"]["user_id"]
    result = resend(client, world, uid).get_json()["result"]
    assert result == {"user_id": uid, "email": "new@a.test", "email_sent": True}


def test_profile_marks_invited_people(client, world):
    uid = invite(client, world).get_json()["result"]["user_id"]
    h = world.headers(world.manager_a)
    assert client.get(f"/admin/staff/{uid}/profile", headers=h).get_json()["profile"]["invited"] is True
    assert client.get(f"/admin/staff/{world.staff_a}/profile", headers=h).get_json()["profile"]["invited"] is False


def test_resend_permissions(app, client, world):
    uid = invite(client, world).get_json()["result"]["user_id"]
    assert client.post("/onboarding/invite/resend", json={"user_id": uid, "location_id": world.loc_a}).status_code == 401
    assert resend(client, world, uid, who=world.staff_a).status_code == 403          # staff
    assert resend(client, world, uid, who=world.owner_b).status_code == 403          # other company
    assert resend(client, world, uid, who=world.owner_b, location_id=world.loc_b).status_code == 404  # not their employee
    assert resend(client, world, world.manager_a).status_code == 400                 # yourself
    assert resend(client, world, world.staff_a).status_code == 400                   # never invited by email


def test_resend_cannot_take_over_senior_accounts(app, client, world):
    mgr_uid = invite(client, world, email="lead@a.test", position="Manager", who=world.owner_a).get_json()["result"]["user_id"]
    owner_uid = invite(client, world, email="co@a.test", position="Owner", who=world.owner_a).get_json()["result"]["user_id"]
    res = resend(client, world, mgr_uid)  # a manager resetting a manager
    assert res.status_code == 403 and "Only an owner" in res.get_json()["error"]
    assert resend(client, world, mgr_uid, who=world.owner_a).status_code == 200      # owner may
    assert resend(client, world, owner_uid, who=world.owner_a).status_code == 403    # owners never


def test_resend_refuses_inactive_employee(app, client, world):
    uid = invite(client, world).get_json()["result"]["user_id"]
    with app.app_context():
        Employment.query.filter_by(user_id=uid).first().status = "inactive"
        db.session.commit()
    res = resend(client, world, uid)
    assert res.status_code == 400 and "inactive" in res.get_json()["error"]
