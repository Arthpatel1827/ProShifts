# MySchedule API

Flask 3 · PostgreSQL · SQLAlchemy 2 · Alembic · Flask-JWT-Extended · Flask-SocketIO (eventlet + Redis) · REST and GraphQL.

Requests flow `routes/` → `controllers/` → `services/` → `models.py`. Location-scoped
authorization helpers live in `services/rbac_service.py`; use them for any endpoint that
takes a `location_id`.

## Setup

Requires Python 3.12, PostgreSQL 14+ and Redis.

```bash
cd backend
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # then fill in real values
createdb myschedule
flask --app app.py db upgrade -d migrations
python app.py                                        # http://localhost:5000
```

Run the server with `python app.py`, not `flask run`: the entrypoint applies the eventlet
monkey-patch that Socket.IO needs to talk to Redis. In production (and in Docker) use
gunicorn, whose eventlet worker patches for you:

```bash
gunicorn --worker-class eventlet --workers 1 --bind 0.0.0.0:5000 app:app
celery -A workers.celery_app:celery worker --loglevel=info     # AI jobs
```

For the full stack (PostgreSQL, Redis, API, worker, web app, HTTPS) see the root
README's Docker section.

### Configuration

All settings come from environment variables (see `.env.example`). In production
(`FLASK_ENV=production`) the app refuses to start unless `JWT_SECRET_KEY` is a random
value of at least 32 characters and `CORS_ORIGINS` lists your web origin(s) rather than `*`.
Native mobile clients are allowed to open sockets regardless of `CORS_ORIGINS`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRUSTED_PROXY_COUNT` | `0` | Proxy hops allowed to set `X-Forwarded-For`. Set to `1` behind Caddy/nginx; leave `0` if Flask is exposed directly, or clients could spoof their IP |
| `RATELIMIT_DEFAULT` | `3000 per hour;300 per minute` | Per signed-in user, or per IP when anonymous |
| `AUTO_CREATE_TABLES` | `true` | Run `db.create_all()` at startup. `false` in Docker, where migrations own the schema |

### Migrations

Alembic owns the schema. `db.create_all()` still runs when the app starts (it only creates
missing tables) but is skipped during `flask db …` commands.

```bash
flask --app app.py db migrate -d migrations -m "describe the change"
flask --app app.py db upgrade -d migrations
```

## Tests

The suite runs against real PostgreSQL and Redis. Use throwaway instances — every table is
truncated between tests.

```bash
createdb myschedule_test
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/myschedule_test \
TEST_REDIS_URL=redis://localhost:6379/15 \
python -m pytest
```

Tests cover auth (login, unverified email, refresh/logout revocation, password reset),
scheduling (overnight shifts, overlap and time-off conflicts, publish, labor cost) and
cross-tenant authorization for every manager endpoint the web app uses.
