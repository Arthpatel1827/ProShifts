# routes/sockets.py
from flask import session
from flask_socketio import join_room, leave_room, emit
from flask_jwt_extended import decode_token
from extensions import socketio
from models import AppUser, ChannelMember, Employment


# This process's open sockets per user, so removing someone from a channel can take
# their sockets out of its room straight away.
_SIDS: dict[int, set] = {}


def leave_channel_rooms(user_id: int, channel_id: int | None = None):
    for sid in list(_SIDS.get(user_id, ())):
        try:
            rooms = [f"channel_{channel_id}"] if channel_id else [
                r for r in (socketio.server.rooms(sid, namespace="/") or []) if str(r).startswith("channel_")]
            for room in rooms:
                socketio.server.leave_room(sid, room, namespace="/")
        except Exception:
            pass


def _socket_user_id():
    # Flask-SocketIO keeps `session` per connection; set once the handshake is verified.
    return session.get("socket_user_id")


def register_socket_handlers():

    @socketio.on("connect")
    def handle_connect(auth):
        token = (auth or {}).get("token", "")
        if not token:
            return False
        try:
            decoded = decode_token(token)
            user_id = int(decoded.get("sub", 0))
            if not AppUser.query.get(user_id):
                return False
        except Exception:
            return False
        session["socket_user_id"] = user_id
        from flask import request as _req
        _SIDS.setdefault(user_id, set()).add(_req.sid)
        join_room(f"user:{user_id}")
        emit("connected", {"message": "Connected to real-time updates", "user_id": user_id})
        return True

    @socketio.on("join")
    def handle_join(data):
        # Rooms carry schedule and labor-cost events, so only members may join them.
        user_id     = _socket_user_id()
        data        = data or {}
        location_id = data.get("location_id")
        company_id  = data.get("company_id")
        if not user_id:
            return
        if location_id and Employment.query.filter_by(
            user_id=user_id, location_id=location_id, status="active"
        ).first():
            join_room(f"location:{location_id}")
            emit("room_joined", {"room": f"location:{location_id}"})
        if company_id and Employment.query.filter_by(
            user_id=user_id, comp_id=company_id, status="active"
        ).first():
            join_room(f"company:{company_id}")
            emit("room_joined", {"room": f"company:{company_id}"})

    @socketio.on("leave")
    def handle_leave(data):
        if data.get("location_id"):
            leave_room(f"location:{data['location_id']}")
        if data.get("company_id"):
            leave_room(f"company:{data['company_id']}")

    @socketio.on("disconnect")
    def handle_disconnect(*_args):
        from flask import request as _req
        uid = _socket_user_id()
        if uid in _SIDS:
            _SIDS[uid].discard(_req.sid)

    @socketio.on("ping_server")
    def handle_ping():
        emit("pong_server", {"status": "ok"})
        
    # ── Messaging ─────────────────────────────────────────────────────────────

    @socketio.on("messaging:join")
    def handle_messaging_join(data):
        """Join socket rooms for the caller's channels — membership is verified per channel."""
        user_id = _socket_user_id()
        if not user_id:
            return
        requested = [int(c) for c in (data or {}).get("channel_ids", []) if str(c).isdigit()]
        if not requested:
            return
        allowed = {
            m.channel_id for m in ChannelMember.query.filter(
                ChannelMember.user_id == user_id,
                ChannelMember.channel_id.in_(requested),
            ).all()
        }
        for channel_id in allowed:
            join_room(f"channel_{channel_id}")

    @socketio.on("messaging:leave")
    def handle_messaging_leave(data):
        channel_id = (data or {}).get("channel_id")
        if channel_id:
            leave_room(f"channel_{channel_id}")

    @socketio.on("typing:start")
    def handle_typing_start(data):
        data       = data or {}
        channel_id = data.get("channel_id")
        user_name  = str(data.get("user_name", "Someone"))[:80]
        user_id    = _socket_user_id()
        if channel_id and user_id and ChannelMember.query.filter_by(
            channel_id=channel_id, user_id=user_id
        ).first():
            emit("typing", {
                "channel_id": channel_id,
                "user_name":  user_name,
                "is_typing":  True,
            }, room=f"channel_{channel_id}", include_self=False)

    @socketio.on("typing:stop")
    def handle_typing_stop(data):
        data       = data or {}
        channel_id = data.get("channel_id")
        user_id    = _socket_user_id()
        if channel_id and user_id and ChannelMember.query.filter_by(
            channel_id=channel_id, user_id=user_id
        ).first():
            emit("typing", {
                "channel_id": channel_id,
                "user_name":  data.get("user_name", "Someone"),
                "is_typing":  False,
            }, room=f"channel_{channel_id}", include_self=False)