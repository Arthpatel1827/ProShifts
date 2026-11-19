from tests.conftest import PASSWORD


def test_login_returns_tokens_and_user(client, world):
    res = client.post("/auth/login", json={"email": "manager@a.test", "password": PASSWORD})
    assert res.status_code == 200
    body = res.get_json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["role"] == "manager"
    assert body["user"]["location_id"] == world.loc_a


def test_login_rejects_wrong_password(client, world):
    res = client.post("/auth/login", json={"email": "manager@a.test", "password": "nope"})
    assert res.status_code == 401
    assert "access_token" not in res.get_json()


def test_login_blocks_unverified_email_with_code(client, world, app):
    from extensions import db
    from models import AppUser
    with app.app_context():
        db.session.get(AppUser, world.staff_a).is_verified = False
        db.session.commit()
    res = client.post("/auth/login", json={"email": "sam@a.test", "password": PASSWORD})
    assert res.status_code == 403
    assert res.get_json()["code"] == "EMAIL_NOT_VERIFIED"


def test_protected_route_requires_token(client, world):
    assert client.get("/auth/me").status_code == 401
    assert client.get(f"/shifts/?location_id={world.loc_a}").status_code == 401


def test_me_returns_full_user(client, world):
    res = client.get("/auth/me", headers=world.headers(world.owner_a))
    assert res.status_code == 200
    body = res.get_json()
    assert body["user_id"] == world.owner_a  # kept for existing clients
    assert body["user"]["display_name"] == "Olive Owner"
    assert body["user"]["role"] == "owner"


def test_refresh_then_logout_revokes_refresh_token(client, world):
    tokens = client.post("/auth/login", json={"email": "owner@a.test", "password": PASSWORD}).get_json()
    refresh = {"Authorization": f"Bearer {tokens['refresh_token']}"}
    assert client.post("/auth/refresh", headers=refresh).status_code == 200
    assert client.post("/auth/logout", headers=refresh).status_code == 200
    assert client.post("/auth/refresh", headers=refresh).status_code == 401


def test_password_reset_rejects_wrong_code(client, world):
    # The mobile app used to show "Password changed" here because this returned 200.
    res = client.post("/auth/forgot-password/confirm",
                      json={"token": "000000", "new_password": "Brand-new-pass1", "confirm_password": "Brand-new-pass1"})
    assert res.status_code == 400
    login = client.post("/auth/login", json={"email": "sam@a.test", "password": PASSWORD})
    assert login.status_code == 200


def test_unknown_routes_return_json(client):
    res = client.get("/definitely-not-a-route")
    assert res.status_code == 404 and "error" in res.get_json()


def test_health_reports_database_and_redis(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok", "database": True, "redis": True}


def test_token_signed_by_another_server_is_422_invalid_token(client, world):
    # The mobile app tells "this phone holds a session from a different server" (422, body
    # {"error": "Invalid token."}) from "expired" (401) and recovers by signing out. If this
    # contract changes, the app's isSessionRejected() must change with it.
    import jwt
    foreign = jwt.encode({"sub": str(world.owner_a), "type": "access", "fresh": False,
                          "jti": "x", "iat": 1, "exp": 4102444800},
                         "a-different-servers-secret-key-0123456789", algorithm="HS256")
    res = client.get("/admin/locations", headers={"Authorization": f"Bearer {foreign}"})
    assert res.status_code == 422
    assert res.get_json() == {"error": "Invalid token."}
    refresh = client.post("/auth/refresh", headers={"Authorization": f"Bearer {foreign}"})
    assert refresh.status_code == 422


def test_expired_and_missing_tokens_are_401(client, world):
    import jwt
    from flask import current_app
    with client.application.app_context():
        expired = jwt.encode({"sub": str(world.owner_a), "type": "access", "fresh": False, "jti": "y",
                              "iat": 1, "exp": 2}, current_app.config["JWT_SECRET_KEY"], algorithm="HS256")
    assert client.get("/admin/locations", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    assert client.get("/admin/locations").status_code == 401
