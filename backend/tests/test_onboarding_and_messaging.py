from tests.conftest import PASSWORD


def test_invite_creates_staff_account(client, world, app):
    res = client.post("/onboarding/invite", headers=world.headers(world.manager_a),
                      json={"email": "new@a.test", "location_id": world.loc_a, "position": "Barista"})
    assert res.status_code == 200, res.get_json()
    staff = client.get(f"/admin/staff?location_id={world.loc_a}", headers=world.headers(world.manager_a)).get_json()["staff"]
    assert any(s["email"] == "new@a.test" and s["role"] == "Barista" for s in staff)
    # Duplicate invite is refused rather than silently resetting the password again.
    again = client.post("/onboarding/invite", headers=world.headers(world.manager_a),
                        json={"email": "new@a.test", "location_id": world.loc_a})
    assert again.status_code == 400


def test_invite_permissions(client, world):
    body = {"email": "x@a.test", "location_id": world.loc_a, "position": "Staff"}
    assert client.post("/onboarding/invite", headers=world.headers(world.staff_a), json=body).status_code == 403
    assert client.post("/onboarding/invite", headers=world.headers(world.owner_b), json=body).status_code == 403
    owner_invite = {**body, "position": "Owner"}
    assert client.post("/onboarding/invite", headers=world.headers(world.manager_a), json=owner_invite).status_code == 403


def test_invite_cannot_reset_another_companys_account(client, world):
    res = client.post("/onboarding/invite", headers=world.headers(world.manager_a),
                      json={"email": "owner@b.test", "location_id": world.loc_a})
    assert res.status_code == 400
    # Their password still works.
    login = client.post("/auth/login", json={"email": "owner@b.test", "password": PASSWORD})
    assert login.status_code == 200


def _group(client, world, members):
    res = client.post("/messaging/channels/group", headers=world.headers(world.manager_a),
                      json={"name": "Openers", "member_ids": members})
    assert res.status_code == 201, res.get_json()
    return res.get_json()["channel"]["channel_id"]


def test_dm_and_groups_are_limited_to_colleagues(client, world):
    h = world.headers(world.manager_a)
    assert client.post("/messaging/channels/dm", headers=h, json={"user_id": world.staff_a}).status_code == 200
    assert client.post("/messaging/channels/dm", headers=h, json={"user_id": world.owner_b}).status_code == 400
    bad = client.post("/messaging/channels/group", headers=h, json={"name": "x", "member_ids": [world.owner_b]})
    assert bad.status_code == 400


def test_messages_reactions_and_membership(client, world):
    cid = _group(client, world, [world.staff_a])
    sent = client.post(f"/messaging/channels/{cid}/messages", headers=world.headers(world.staff_a),
                       json={"content": "Morning @Max"})
    assert sent.status_code == 201
    mid = sent.get_json()["message"]["message_id"]

    # Non-members can't read, post or react.
    outsider = world.headers(world.staff_a2)
    assert client.get(f"/messaging/channels/{cid}/messages", headers=outsider).status_code == 403
    assert client.post(f"/messaging/channels/{cid}/messages", headers=outsider, json={"content": "hi"}).status_code == 403
    assert client.post(f"/messaging/messages/{mid}/react", headers=outsider, json={"emoji": "👍"}).status_code == 403

    assert client.post(f"/messaging/messages/{mid}/react", headers=world.headers(world.manager_a),
                       json={"emoji": "👍"}).get_json()["added"] is True
    msgs = client.get(f"/messaging/channels/{cid}/messages", headers=world.headers(world.manager_a)).get_json()["messages"]
    assert msgs[-1]["reactions"] == [{"emoji": "👍", "count": 1, "mine": True}]


def test_mentions_notify_channel_members_by_name(client, world):
    cid = _group(client, world, [world.staff_a])
    client.post(f"/messaging/channels/{cid}/messages", headers=world.headers(world.staff_a),
                json={"content": "@Max can you cover? cc @Bea"})
    mgr = client.get("/notifications/", headers=world.headers(world.manager_a)).get_json()["notifications"]
    other = client.get("/notifications/", headers=world.headers(world.owner_b)).get_json()["notifications"]
    assert any(n["type"] == "mention" for n in mgr)
    # Bea isn't in the channel (or the company) and must not be notified.
    assert not any(n["type"] == "mention" for n in other)
