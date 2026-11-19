# tests/test_realtime.py
"""Live channel events follow server-side membership: removed or deactivated people stop
receiving messages and typing indicators immediately, without reconnecting."""
import pytest
from flask_jwt_extended import create_access_token

from extensions import socketio


@pytest.fixture
def sock(app, world):
    clients = []

    def connect(user_id):
        with app.app_context():
            token = create_access_token(identity=str(user_id))
        c = socketio.test_client(app, auth={"token": token})
        assert c.is_connected()
        clients.append(c)
        return c

    yield connect
    for c in clients:
        if c.is_connected():
            c.disconnect()


def events(client, name):
    return [e["args"][0] for e in client.get_received() if e["name"] == name]


def group(client, world, ids):
    res = client.post("/messaging/channels/group", headers=world.headers(world.manager_a),
                      json={"name": "Closers", "member_ids": ids})
    return res.get_json()["channel"]["channel_id"]


def test_removed_member_stops_getting_typing_and_messages(app, client, world, sock):
    gid = group(client, world, [world.staff_a, world.staff_a2])
    sam, ria = sock(world.staff_a), sock(world.staff_a2)
    # Ria even joins the old channel room; it must not matter.
    ria.emit("messaging:join", {"channel_ids": [gid]})
    sam.get_received(); ria.get_received()

    sam.emit("typing:start", {"channel_id": gid, "user_name": "spoofed"})
    got = events(ria, "typing")
    assert got and got[0]["user_name"] == "Sam Staff" and got[0]["is_typing"] is True  # name from the account
    assert events(sam, "typing") == []  # not echoed to the typist

    assert client.delete(f"/messaging/channels/{gid}/members/{world.staff_a2}",
                         headers=world.headers(world.manager_a)).status_code == 200
    ria.get_received()

    sam.emit("typing:start", {"channel_id": gid})
    client.post(f"/messaging/channels/{gid}/messages", headers=world.headers(world.staff_a), json={"content": "after removal"})
    received = ria.get_received()
    assert not [e for e in received if e["name"] in ("typing", "message:new", "message:reaction", "message:pinned")]


def test_non_member_cannot_send_typing(app, client, world, sock):
    gid = group(client, world, [world.staff_a])
    sam, ria = sock(world.staff_a), sock(world.staff_a2)
    sam.get_received()
    ria.emit("typing:start", {"channel_id": gid})
    assert events(sam, "typing") == []


def test_deactivated_employee_stops_getting_general(app, client, world, sock):
    client.post("/messaging/channels/setup", headers=world.headers(world.manager_a), json={"location_id": world.loc_a})
    from models import Channel
    with app.app_context():
        gen = Channel.query.filter_by(location_id=world.loc_a, channel_type="general").first().channel_id
    ria = sock(world.staff_a2)
    client.post(f"/messaging/channels/{gen}/messages", headers=world.headers(world.manager_a), json={"content": "hello team"})
    assert [m["content"] for m in events(ria, "message:new")] == ["hello team"]
    client.put(f"/admin/staff/{world.staff_a2}/profile", headers=world.headers(world.manager_a), json={"status": "inactive"})
    ria.get_received()
    client.post(f"/messaging/channels/{gen}/messages", headers=world.headers(world.manager_a), json={"content": "after"})
    assert events(ria, "message:new") == []


def test_other_company_never_gets_events(app, client, world, sock):
    client.post("/messaging/channels/setup", headers=world.headers(world.manager_a), json={"location_id": world.loc_a})
    from models import Channel
    with app.app_context():
        gen = Channel.query.filter_by(location_id=world.loc_a, channel_type="general").first().channel_id
    bea = sock(world.owner_b)
    bea.emit("messaging:join", {"channel_ids": [gen]})
    bea.get_received()
    client.post(f"/messaging/channels/{gen}/messages", headers=world.headers(world.manager_a), json={"content": "internal"})
    assert events(bea, "message:new") == []
