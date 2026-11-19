# tests/test_logging_and_reset.py
"""
Under gunicorn nothing configured logging, so INFO lines were dropped — including the
"[DEV] Password reset OTP" line that is the only way to get a reset code while email
isn't configured (the Docker default). These tests pin that the line is emitted and that
the code it carries really resets the password, end to end.
"""
import logging
import re

from tests.conftest import PASSWORD


def test_info_logging_is_enabled_for_app_and_proshifts_loggers(app):
    assert app.logger.isEnabledFor(logging.INFO)
    for name in ("proshifts.audit", "proshifts.ai", "proshifts.config"):
        assert logging.getLogger(name).isEnabledFor(logging.INFO), name
    # one handler on the parent — child loggers must not add their own (duplicate lines)
    assert len(logging.getLogger("proshifts").handlers) == 1
    assert not logging.getLogger("proshifts.ai").handlers


def test_reset_code_is_logged_when_email_is_off_and_resets_the_password(app, client, world, caplog):
    caplog.set_level(logging.INFO)
    res = client.post("/auth/forgot-password", json={"email": "sam@a.test"})
    assert res.status_code == 200
    assert "reset code has been sent" in res.get_json()["message"]

    match = re.search(r"Password reset OTP for sam@a\.test: (\d{6})", caplog.text)
    assert match, "the reset code must reach the server log when email sending is disabled"

    new_pw = "Brand-new-pass1"
    res = client.post("/auth/forgot-password/confirm",
                      json={"token": match.group(1), "new_password": new_pw, "confirm_password": new_pw})
    assert res.status_code == 200, res.get_json()
    assert client.post("/auth/login", json={"email": "sam@a.test", "password": new_pw}).status_code == 200
    assert client.post("/auth/login", json={"email": "sam@a.test", "password": PASSWORD}).status_code == 401
    # a code works once
    again = client.post("/auth/forgot-password/confirm",
                        json={"token": match.group(1), "new_password": new_pw, "confirm_password": new_pw})
    assert again.status_code == 400


def test_unknown_email_gets_the_same_answer_and_no_code(client, world, caplog):
    caplog.set_level(logging.INFO)
    res = client.post("/auth/forgot-password", json={"email": "nobody@nowhere.test"})
    assert res.status_code == 200
    assert "reset code has been sent" in res.get_json()["message"]
    assert "Password reset OTP" not in caplog.text
