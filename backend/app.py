# app.py
if __name__ == "__main__":
    # Must run before anything else is imported. Flask-SocketIO uses eventlet with a
    # Redis message queue; without patching, every socket connection fails with
    # "Redis requires a monkey patched socket library to work with eventlet".
    import eventlet
    eventlet.monkey_patch()

import os
import sys
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from config import DevConfig, ProdConfig
from extensions import init_extensions, socketio

import models  # noqa: F401 — needed for Flask-Migrate


def create_app():
    app = Flask(__name__)
    app.config.from_object(
        ProdConfig if os.getenv("FLASK_ENV") == "production" else DevConfig
    )

    if app.config.get("ENV_NAME") == "production":
        secret = app.config.get("JWT_SECRET_KEY") or ""
        if secret == "dev-change-me" or len(secret) < 32:
            raise RuntimeError("JWT_SECRET_KEY must be set to a random value of 32+ characters in production")
        if os.getenv("CORS_ORIGINS", "*").strip() == "*":
            raise RuntimeError("CORS_ORIGINS must list your web app origin(s) in production, not '*'")

    init_extensions(app)

    # Clock-in PINs need their own key. Missing → PIN features answer 503 with what to set;
    # the rest of the app works. The value itself is never logged.
    with app.app_context():
        from services.kiosk_service import kiosk_secret_problem
        problem = kiosk_secret_problem(app.config.get("KIOSK_PIN_SECRET"))
        if problem:
            import logging as _logging
            _logging.getLogger("proshifts.config").warning(
                "Personal clock-in PINs are disabled: %s. Set it in backend/.env.", problem)

    # AI request logs (feature, model, latency, outcome — never keys or prompts). Nothing
    # else configures logging, so without a handler these INFO lines would be dropped.
    import logging
    ai_log = logging.getLogger("proshifts.ai")
    if not ai_log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        ai_log.addHandler(handler)
        ai_log.setLevel(os.getenv("AI_LOG_LEVEL", "INFO").upper())

    origins =[o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    CORS(app, resources={r"/*": {"origins": "*" if origins == ["*"] else origins}})

    # REST Blueprints
    from routes.auth          import router as auth_router
    from routes.onboarding    import router as onboarding_router
    from routes.availability  import router as availability_router
    from routes.admin         import admin_bp
    from routes.shifts        import router as shifts_router
    from routes.swaps         import router as swaps_router
    from routes.notifications import router as notifications_router
    from routes.ai            import router as ai_router
    from routes.time_entries  import router as time_entries_router
    from routes.analytics     import analytics_bp
    from routes.drops         import drops_bp
    from routes.time_off import time_off_bp
    from routes.messaging import messaging_bp
    from routes.kiosk import router as kiosk_router
    
    app.register_blueprint(auth_router)
    app.register_blueprint(onboarding_router)
    app.register_blueprint(availability_router)
    app.register_blueprint(admin_bp)
    app.register_blueprint(shifts_router)
    app.register_blueprint(swaps_router)
    app.register_blueprint(notifications_router)
    app.register_blueprint(ai_router)
    app.register_blueprint(time_entries_router)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(drops_bp)
    app.register_blueprint(time_off_bp)
    app.register_blueprint(messaging_bp)
    app.register_blueprint(kiosk_router)
    
    # GraphQL
    from gql_server.graphql_server import register_graphql_route
    register_graphql_route(app)

    # WebSockets
    from routes.sockets import register_socket_handlers
    register_socket_handlers()

    # Consistent JSON errors — clients always get {"error": ...}, never an HTML page or traceback.
    from werkzeug.exceptions import HTTPException

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        if err.code is None or err.code < 400:
            return err  # e.g. RequestRedirect (308 to the trailing-slash URL) must keep its Location
        return jsonify({"error": err.description or err.name}), err.code

    @app.errorhandler(Exception)
    def handle_unexpected_error(err):
        app.logger.exception("Unhandled error")
        return jsonify({"error": "Something went wrong"}), 500

    @app.get("/ping")
    def ping():
        return jsonify({"ok": True})

    @app.get("/")
    def root():
        return jsonify({"message": "ProShifts API 🚀", "version": "2.0.0"})

    @app.get("/health")
    def health():
        from extensions import redis_client
        redis_ok = False
        try:
            redis_ok = redis_client.ping() if redis_client else False
        except Exception:
            pass
        return jsonify({"status": "ok", "redis": redis_ok}), 200

    # `flask db …` commands must let Alembic own the schema: creating tables here first
    # makes the initial migration fail with "relation already exists" on a fresh database.
    # Matches both `flask db upgrade` and `flask --app app.py db upgrade`.
    # `python -m flask db …` (what Windows needs) runs flask/__main__.py, so check the path too.
    argv0 = sys.argv[0].replace("\\", "/")
    is_flask_cli = os.path.basename(argv0).startswith("flask") or argv0.endswith("flask/__main__.py")
    running_migrations = is_flask_cli and "db" in sys.argv[1:4]
    if not running_migrations:
        with app.app_context():
            from extensions import db
            from sqlalchemy import text
            # app_user.user_email uses CITEXT; the type must exist before create_all.
            db.session.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
            db.session.commit()
            db.create_all()

    return app


app = create_app()

if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=os.getenv("FLASK_ENV") != "production",
    )