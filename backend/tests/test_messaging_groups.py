# tests/test_messaging_groups.py
"""#general holds every active employee; private groups are managed by managers and
group admins; the backend enforces it (not just hidden buttons)."""
from extensions import db
from models import Channel, ChannelMember, Employment, Role


def setup(client, world):
    res = client.post("/messaging/channels/setup", headers=world.headers(world.manager_a), json={"location_id": world.loc_a})
    assert res.status_code == 200, res.get_json()


def members(app, channel_type="general", name=None, loc=None):
    with app.app_context():
        q = Channel.query.filter_by(channel_type=channel_type)
        if name:
            q = q.filter_by(name=name)
        if loc:
            q = q.filter_by(location_id=loc)
        ch = q.first()
        return ch.channel_id, {m.user_id: m.is_admin for m in ch.members}


def group(client, world, ids, who=None):
    res = client.post("/messaging/channels/group", headers=world.headers(who or world.manager_a),
                      json={"name": "Kitchen crew", "member_ids": ids})
    assert res.status_code == 201, res.get_json()
    return res.get_json()["channel"]["channel_id"]


def test_general_has_every_active_employee(app, client, world):
    setup(client, world)
    _, m = members(app, loc=world.loc_a)
    assert set(m) == {world.owner_a, world.manager_a, world.staff_a, world.staff_a2}
    assert m[world.manager_a] is True and m[world.staff_a] is False


def test_new_employee_joins_general_automatically(app, client, world):
    setup(client, world)
    res = client.post("/onboarding/invite", headers=world.headers(world.manager_a),
                      json={"email": "newbie@a.test", "location_id": world.loc_a, "role": "Barista"})
    assert res.status_code in (200, 201), res.get_json()
    _, m = members(app, loc=world.loc_a)
    with app.app_context():
        from models import AppUser
        newbie = AppUser.query.filter_by(user_email="newbie@a.test").first().user_id
    assert newbie in m and len(m) == 5


def test_existing_staff_missing_from_general_are_added(app, client, world):
    # The reported bug: General stuck at the people present when it was created.
    setup(client, world)
    cid, _ = members(app, loc=world.loc_a)
    with app.app_context():
        ChannelMember.query.filter_by(channel_id=cid, user_id=world.staff_a2).delete()
        db.session.commit()
    client.get("/messaging/channels", headers=world.headers(world.staff_a))
    assert world.staff_a2 in members(app, loc=world.loc_a)[1]


def test_inactive_employee_not_in_general_and_leaves_groups(app, client, world):
    setup(client, world)
    gid = group(client, world, [world.staff_a2])
    res = client.put(f"/admin/staff/{world.staff_a2}/profile", headers=world.headers(world.manager_a), json={"status": "inactive"})
    assert res.status_code == 200
    assert world.staff_a2 not in members(app, loc=world.loc_a)[1]
    with app.app_context():
        assert not ChannelMember.query.filter_by(channel_id=gid, user_id=world.staff_a2).first()
    assert client.get(f"/messaging/channels/{gid}/messages", headers=world.headers(world.staff_a2)).status_code == 403
    # Reactivated: back in #general (not in the private group).
    client.put(f"/admin/staff/{world.staff_a2}/profile", headers=world.headers(world.manager_a), json={"status": "active"})
    assert world.staff_a2 in members(app, loc=world.loc_a)[1]


def test_other_company_never_in_general(app, client, world):
    setup(client, world)
    client.get("/messaging/channels", headers=world.headers(world.owner_b))
    assert world.owner_b not in members(app, loc=world.loc_a)[1]


def test_role_channels_are_private(app, client, world):
    setup(client, world)
    _, m = members(app, channel_type="role", name="barista")
    # Managers are admins; baristas aren't auto-added.
    assert world.staff_a not in m and m.get(world.owner_a) is True and m.get(world.manager_a) is True


def test_manager_adds_and_removes_private_group_members(app, client, world):
    gid = group(client, world, [world.staff_a])
    h = world.headers(world.manager_a)
    assert client.post(f"/messaging/channels/{gid}/members", headers=h, json={"user_id": world.staff_a2}).status_code == 200
    assert client.delete(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=h).status_code == 200


def test_manager_not_in_group_can_still_manage_it(app, client, world):
    gid = group(client, world, [world.staff_a], who=world.owner_a)
    with app.app_context():
        ChannelMember.query.filter_by(channel_id=gid, user_id=world.owner_a).delete()
        db.session.commit()
    # The manager at the location manages it without being a member…
    h = world.headers(world.manager_a)
    assert client.get(f"/messaging/channels/{gid}/members", headers=h).status_code == 200
    assert client.post(f"/messaging/channels/{gid}/members", headers=h, json={"user_id": world.staff_a2}).status_code == 200
    groups = client.get(f"/messaging/locations/{world.loc_a}/groups", headers=h).get_json()["channels"]
    assert any(g["channel_id"] == gid for g in groups)
    # …but staff can't list groups they aren't in.
    assert client.get(f"/messaging/locations/{world.loc_a}/groups", headers=world.headers(world.staff_a)).status_code == 403


def test_promote_and_admin_powers(app, client, world):
    gid = group(client, world, [world.staff_a, world.staff_a2])
    mgr, sam, ria = (world.headers(u) for u in (world.manager_a, world.staff_a, world.staff_a2))
    # Ordinary member can't add, remove or promote.
    assert client.post(f"/messaging/channels/{gid}/members", headers=sam, json={"user_id": world.owner_a}).status_code == 403
    assert client.delete(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=sam).status_code == 403
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a}", headers=sam, json={"is_admin": True}).status_code == 403
    # Manager promotes Sam.
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a}", headers=mgr, json={"is_admin": True}).status_code == 200
    # Group admin Sam adds the owner and promotes Ria.
    assert client.post(f"/messaging/channels/{gid}/members", headers=sam, json={"user_id": world.owner_a}).status_code == 200
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=sam, json={"is_admin": True}).status_code == 200
    # An admin can't demote or remove another admin; a manager can.
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=sam, json={"is_admin": False}).status_code == 403
    assert client.delete(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=sam).status_code == 403
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=mgr, json={"is_admin": False}).status_code == 200
    # Admin removes a regular member; anyone may step down themselves.
    assert client.delete(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=sam).status_code == 200
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a}", headers=sam, json={"is_admin": False}).status_code == 200


def test_cannot_join_or_self_promote_or_cross_company(app, client, world):
    gid = group(client, world, [world.staff_a])
    ria = world.headers(world.staff_a2)
    # Not a member: can't add themselves, read, or promote themselves.
    assert client.post(f"/messaging/channels/{gid}/members", headers=ria, json={"user_id": world.staff_a2}).status_code == 403
    assert client.get(f"/messaging/channels/{gid}/messages", headers=ria).status_code == 403
    assert client.get(f"/messaging/channels/{gid}/members", headers=ria).status_code == 403
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a2}", headers=ria, json={"is_admin": True}).status_code == 400
    # Member can't promote themselves.
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a}", headers=world.headers(world.staff_a), json={"is_admin": True}).status_code == 403
    # Another company's user can't be added, nor can their owner manage this group.
    mgr = world.headers(world.manager_a)
    assert client.post(f"/messaging/channels/{gid}/members", headers=mgr, json={"user_id": world.owner_b}).status_code == 403
    assert client.post(f"/messaging/channels/{gid}/members", headers=world.headers(world.owner_b), json={"user_id": world.owner_b}).status_code == 403
    assert client.patch(f"/messaging/channels/{gid}/members/{world.staff_a}", headers=world.headers(world.owner_b), json={"is_admin": True}).status_code == 403


def test_general_membership_cannot_be_hand_edited(app, client, world):
    setup(client, world)
    cid, _ = members(app, loc=world.loc_a)
    mgr = world.headers(world.manager_a)
    assert client.delete(f"/messaging/channels/{cid}/members/{world.staff_a}", headers=mgr).status_code == 400
    assert client.post(f"/messaging/channels/{cid}/members", headers=mgr, json={"user_id": world.owner_b}).status_code == 400


def test_setup_only_for_own_location(client, world):
    assert client.post("/messaging/channels/setup", headers=world.headers(world.owner_b), json={"location_id": world.loc_a}).status_code == 403
    assert client.post("/messaging/channels/setup", headers=world.headers(world.staff_a), json={"location_id": world.loc_a}).status_code == 403
