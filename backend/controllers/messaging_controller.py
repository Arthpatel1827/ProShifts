# controllers/messaging_controller.py
from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity
from services.messaging_service import MessagingService
from models import Employment, Message

svc = MessagingService()


def _emit_to_members(channel_id, event, payload):
    """Deliver to each CURRENT member's own room. A channel room could still hold the
    socket of someone just removed; personal rooms can't leak to them."""
    try:
        from extensions import socketio
        from models import ChannelMember
        for m in ChannelMember.query.filter_by(channel_id=channel_id).all():
            socketio.emit(event, payload, room=f"user:{m.user_id}")
    except Exception:
        pass


class MessagingController:

    def get_my_channels(self):
        try:
            user_id = int(get_jwt_identity())
            # Self-heal: everyone active at a location is in its #general.
            for emp in Employment.query.filter_by(user_id=user_id, status="active").all():
                if emp.location_id:
                    svc.sync_general(emp.location_id)
            data    = svc.get_channels_for_user(user_id)
            return jsonify({
                "channels": [
                    svc.serialize_channel(
                        d["channel"], user_id,
                        unread=d["unread"],
                        last_msg=d["last_msg"],
                    )
                    for d in data
                ]
            }), 200
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def create_group(self):
        try:
            user_id = int(get_jwt_identity())
            emp     = Employment.query.filter_by(user_id=user_id, status="active").first()
            if not emp or (emp.role.name if emp.role else "").lower() not in ("owner", "manager"):
                return jsonify({"error": "Only managers can create groups"}), 403

            data         = request.get_json(silent=True) or {}
            name         = (data.get("name") or "").strip()
            member_ids   = data.get("member_ids", [])
            is_broadcast = bool(data.get("is_broadcast", False))
            description  = (data.get("description") or "").strip() or None

            if not name:
                return jsonify({"error": "Group name required"}), 400

            channel = svc.create_group(
                name=name,
                member_ids=[int(m) for m in member_ids],
                creator_id=user_id,
                location_id=emp.location_id,
                is_broadcast=is_broadcast,
                description=description,
            )
            return jsonify({"message": "Group created", "channel": svc.serialize_channel(channel, user_id)}), 201
        except (ValueError, PermissionError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def get_or_create_dm(self):
        try:
            user_id  = int(get_jwt_identity())
            data     = request.get_json(silent=True) or {}
            other_id = data.get("user_id")
            if not other_id:
                return jsonify({"error": "user_id required"}), 400
            channel = svc.get_or_create_dm(user_id, int(other_id))
            return jsonify({"channel": svc.serialize_channel(channel, user_id)}), 200
        except (ValueError, PermissionError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def setup_channels(self):
        try:
            user_id     = int(get_jwt_identity())
            data        = request.get_json(silent=True) or {}
            location_id = data.get("location_id")
            if not location_id:
                emp = Employment.query.filter_by(user_id=user_id, status="active").first()
                location_id = emp.location_id if emp else None
            if not location_id:
                return jsonify({"error": "location_id required"}), 400
            # Only for a location the caller manages.
            mgr = Employment.query.filter_by(user_id=user_id, location_id=int(location_id), status="active").first()
            if not mgr or (mgr.role.name if mgr.role else "").lower() not in ("owner", "manager", "supervisor"):
                return jsonify({"error": "Manager access required"}), 403
            svc.setup_location_channels(int(location_id), user_id)
            return jsonify({"message": "Channels initialized"}), 200
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def create_shift_thread(self, shift_id: int):
        try:
            user_id = int(get_jwt_identity())
            channel = svc.create_shift_thread(shift_id, user_id)
            return jsonify({"message": "Thread created", "channel": svc.serialize_channel(channel, user_id)}), 201
        except (ValueError, PermissionError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def get_messages(self, channel_id: int):
        try:
            user_id   = int(get_jwt_identity())
            before_id = request.args.get("before_id", type=int)
            limit     = min(request.args.get("limit", 50, type=int), 100)
            messages  = svc.get_messages(channel_id, user_id, before_id, limit)
            return jsonify({
                "messages": [svc.serialize_message(m, user_id) for m in messages],
                "has_more": len(messages) == limit,
            }), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def send_message(self, channel_id: int):
        try:
            user_id     = int(get_jwt_identity())
            data        = request.get_json(silent=True) or {}
            content     = (data.get("content") or "").strip()
            reply_to_id = data.get("reply_to_id")

            if not content:
                return jsonify({"error": "Message content required"}), 400

            msg        = svc.send_message(
                channel_id=channel_id,
                sender_id=user_id,
                content=content,
                reply_to_id=int(reply_to_id) if reply_to_id else None,
            )
            serialized = svc.serialize_message(msg, user_id)

            _emit_to_members(channel_id, 'message:new', serialized)

            return jsonify({"message": serialized}), 201
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except (ValueError, PermissionError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def mark_read(self, channel_id: int):
        try:
            user_id = int(get_jwt_identity())
            svc.mark_read(channel_id, user_id)
            return jsonify({"message": "Marked as read"}), 200
        except Exception:
            return jsonify({"error": "Something went wrong"}), 500

    def get_pinned(self, channel_id: int):
        try:
            user_id  = int(get_jwt_identity())
            messages = svc.get_pinned(channel_id, user_id)
            return jsonify({"messages": [svc.serialize_message(m, user_id) for m in messages]}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def toggle_pin(self, message_id: int):
        try:
            user_id    = int(get_jwt_identity())
            msg        = svc.toggle_pin(message_id, user_id)
            serialized = svc.serialize_message(msg, user_id)
            _emit_to_members(msg.channel_id, 'message:pinned', serialized)
            return jsonify({"message": serialized, "is_pinned": msg.is_pinned}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def toggle_reaction(self, message_id: int):
        try:
            user_id = int(get_jwt_identity())
            data    = request.get_json(silent=True) or {}
            emoji   = (data.get("emoji") or "").strip()
            if not emoji:
                return jsonify({"error": "emoji required"}), 400
            added = svc.toggle_reaction(message_id, user_id, emoji)
            msg   = Message.query.get(message_id)
            if msg:
                _emit_to_members(msg.channel_id, 'message:reaction', {
                    "message_id": message_id,
                    "channel_id": msg.channel_id,
                    "emoji":      emoji,
                    "user_id":    user_id,
                    "added":      added,
                })
            return jsonify({"added": added, "emoji": emoji}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def get_members(self, channel_id: int):  # noqa: C901
        try:
            user_id = int(get_jwt_identity())
            members = svc.get_members(channel_id, user_id)
            return jsonify({
                "members": [
                    {
                        "user_id":   m.user_id,
                        "name":      (m.user.display_name or m.user.username) if m.user else "Unknown",
                        "initials":  svc._initials(m.user) if m.user else "?",
                        "is_admin":  m.is_admin,
                        "joined_at": m.joined_at.isoformat(),
                        "role":      _role_name(m.user_id, channel_id),
                    }
                    for m in members if m.user
                ]
            }), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def add_member(self, channel_id: int):
        try:
            user_id     = int(get_jwt_identity())
            data        = request.get_json(silent=True) or {}
            new_user_id = data.get("user_id")
            if not new_user_id:
                return jsonify({"error": "user_id required"}), 400
            svc.add_member(channel_id, int(new_user_id), user_id)
            return jsonify({"message": "Member added"}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

    def remove_member(self, channel_id: int, member_id: int):
        try:
            svc.remove_member(channel_id, member_id, int(get_jwt_identity()))
            return jsonify({"message": "Member removed"}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def set_admin(self, channel_id: int, member_id: int):
        try:
            data = request.get_json(silent=True) or {}
            if "is_admin" not in data:
                return jsonify({"error": "is_admin required"}), 400
            m = svc.set_admin(channel_id, member_id, bool(data["is_admin"]), int(get_jwt_identity()))
            return jsonify({"message": "Updated", "is_admin": m.is_admin}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    def location_groups(self, location_id: int):
        try:
            user_id = int(get_jwt_identity())
            groups = svc.location_groups(location_id, user_id)
            return jsonify({"channels": [svc.serialize_channel(c, user_id) for c in groups]}), 200
        except PermissionError as e:
            return jsonify({"error": str(e)}), 403
        except Exception:
            import traceback; traceback.print_exc()
            return jsonify({"error": "Something went wrong"}), 500

def _role_name(user_id, channel_id):
    from models import Channel
    ch = Channel.query.get(channel_id)
    emp = Employment.query.filter_by(user_id=user_id, location_id=ch.location_id).first() if ch and ch.location_id else None
    return emp.role.name if emp and emp.role else None
