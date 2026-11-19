# utils/realtime.py
"""Channel events go to each CURRENT member's personal socket room (user:<id>).

Membership in the database is authoritative: nothing is broadcast to a shared channel
room, so someone removed from a group (or deactivated) stops receiving its messages,
typing indicators and other events at once — no client reconnect needed.
"""


def emit_to_channel_members(channel_id, event, payload, exclude_user_id=None):
    from extensions import socketio
    from models import ChannelMember
    for m in ChannelMember.query.filter_by(channel_id=channel_id).all():
        if m.user_id == exclude_user_id:
            continue
        try:
            socketio.emit(event, payload, room=f"user:{m.user_id}")
        except Exception:
            pass
