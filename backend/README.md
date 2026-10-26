# ProShifts API

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

### AI (NVIDIA Nemotron)

AI features call NVIDIA's OpenAI-compatible API from the backend only; the key never
reaches the web or mobile apps. Set in `backend/.env`:

| Variable | Default | |
|---|---|---|
| `NVIDIA_API_KEY` | — | From [build.nvidia.com](https://build.nvidia.com). Without it AI endpoints return `503 AI_NOT_CONFIGURED` and everything else works. |
| `NVIDIA_NEMOTRON_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | Any Nemotron model with tool calling. |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | Point at a self-hosted NIM if needed. |
| `NVIDIA_TIMEOUT_SECONDS` | `60` | |
| `NVIDIA_NEMOTRON_REASONING` | `false` | Turn on Nemotron's thinking mode (slower). |
| `OVERTIME_WEEKLY_HOURS` | `40` | Weekly overtime threshold for your jurisdiction. |

The model is never the source of truth (`ai/`):

- **Assistant** (`POST /ai/assistant`) answers by calling read-only tools (`ai/tools.py`) that
  query the caller's location. IDs the model sends back are re-checked against that location.
- **Schedule Copilot** (`POST /ai/schedule/generate`) gets structured recommendations,
  validates each one in `ai/validators.py` (availability, approved time off, overlaps, role,
  weekly max hours, overtime, shift length, company/location) and computes coverage and cost
  itself. Nothing is saved. `POST /ai/schedule/apply` re-validates and creates **draft** shifts
  through `ShiftService`; publishing stays the normal publish flow.
- **Insights** (`GET /ai/insights`) are computed facts; `&ai=1` adds Nemotron's suggestions,
  kept separate from the facts.

Every AI endpoint requires a manager role at the requested location. Logs (`proshifts.ai`)
record feature, model, latency and outcome — never keys, prompts or employee data.

### Migrations

Alembic owns the schema. `db.create_all()` still runs when the app starts (it only creates
missing tables) but is skipped during `flask db …` commands.

```bash
flask --app app.py db migrate -d migrations -m "describe the change"
flask --app app.py db upgrade -d migrations
```

## Clock-in PINs and the punch-in tablet

Staff choose a personal 4-digit PIN in the app; a manager turns a browser at the store
into the punch-in tablet (web: Settings → Punch-in tablets).

```text
KIOSK_PIN_SECRET  →  key for HMAC-SHA256 of each PIN  →  only the keyed hash is stored
```

- **Required for PINs.** Put a random value of 32+ characters in `backend/.env`, different
  from `JWT_SECRET_KEY`:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
  Without it (or with the `.env.example` placeholder, a short value, or the JWT secret)
  the app still runs, logs a warning at startup, and the PIN endpoints answer
  `503 KIOSK_NOT_CONFIGURED` saying what to set. The value is never logged or returned.
- **Independent of the JWT secret.** Rotating `JWT_SECRET_KEY` (signs everyone out) does
  not affect PINs, and a copy of the database plus the JWT secret doesn't reveal PINs.
- **Changing `KIOSK_PIN_SECRET`** makes every existing PIN stop matching: staff set a new
  PIN in the app (Me → Clock-in PIN). Only change it if it may have leaked.
- Never commit `backend/.env`. `.env.example` holds a placeholder only.

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
scheduling (overnight shifts, overlap and time-off conflicts, publish, labor cost),
cross-tenant authorization for every manager endpoint the web app uses, location timezones,
and the AI layer (`tests/test_ai.py`: only the HTTP call to NVIDIA is stubbed; data, tools,
validation and endpoints are real).
