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
monkey-patch that Socket.IO needs to talk to Redis.

### Configuration

All settings come from environment variables (see `.env.example`). In production
(`FLASK_ENV=production`) the app refuses to start unless `JWT_SECRET_KEY` is a random
value of at least 32 characters and `CORS_ORIGINS` lists your web origin(s) rather than `*`.
Native mobile clients are allowed to open sockets regardless of `CORS_ORIGINS`.

### Timezones

Each location's `timezone` (an IANA name such as `America/Toronto`, editable via
`PUT /admin/locations/<id>` or the web app's top bar) defines its calendar day: "today",
week boundaries, Today's Team, late detection and analytics. Shift and clock times are
stored as absolute instants; a naive time sent by a client means wall-clock time at the
shift's location. All of this lives in `utils/timezones.py`; never compute day boundaries
with UTC midnight or compare naive datetimes against `timestamptz` columns.

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
