# MySchedule (ProShifts)

Workforce scheduling for hourly teams: schedules, time tracking, shift swaps,
time off and team messaging.

| Part | Path | Stack |
| --- | --- | --- |
| API | `backend/` | Flask 3, PostgreSQL, Redis, Celery, Socket.IO |
| Manager web app | `frontend/myschedule-web/` | Next.js 16, Tailwind v4 |
| Staff mobile app | `frontend/myscheduleapp/` | Expo React Native |

## Run everything with Docker

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and JWT_SECRET_KEY
docker compose up -d --build
```

| Service | What it does |
| --- | --- |
| `caddy` | The only public entry point. HTTPS for real domains; routes the web app, `/socket.io` and the API |
| `web` | Next.js manager app |
| `api` | Flask API on gunicorn + eventlet |
| `worker` | Celery jobs (AI schedule generation, staffing prediction) |
| `migrate` | Applies Alembic migrations, then exits; `api` and `worker` wait for it |
| `postgres`, `redis` | Data stores with persistent volumes, internal only |

With the example settings, the web app is on http://localhost and the API (for the mobile
app) on http://localhost:8080. Point the mobile app at it with
`EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:8080` in `frontend/myscheduleapp/.env`.

The first owner account is created from the mobile app's sign-up flow.

## Deploying to a server

1. Point two DNS records at the server, e.g. `app.example.com` and `api.example.com`.
2. In `.env` set:
   ```
   WEB_ADDRESS=app.example.com
   API_ADDRESS=api.example.com
   WEB_ORIGIN=https://app.example.com
   ```
   and remove `COOKIE_SECURE=false`.
3. Open ports 80 and 443, then `docker compose up -d --build`. Caddy obtains and renews
   the TLS certificates itself.
4. Build the mobile app with `EXPO_PUBLIC_API_URL=https://api.example.com`.

Updating: `git pull && docker compose up -d --build`. Migrations run automatically.

### Operations

- **Health:** `GET /health` on the API returns 200 only when PostgreSQL and Redis both
  respond. Compose uses it to start `web` and `caddy` only once the API is ready, and
  `docker compose ps` shows it. Crashed containers restart (`restart: unless-stopped`);
  point your uptime monitor at `https://api.example.com/health`.
- **Logs:** `docker compose logs -f api worker web caddy`.
- **Backups:** the data lives in the `postgres-data` volume. For example, nightly:
  `docker compose exec -T postgres pg_dump -U myschedule myschedule | gzip > backup-$(date +%F).sql.gz`.
- **Scaling:** `docker compose up -d --scale api=3` adds API containers. Socket.IO events
  fan out through Redis, and both clients use the WebSocket transport only, so no sticky
  sessions are needed. Keep one gunicorn worker per container.
- **Rate limits:** per user when signed in, per client IP otherwise; login, sign-up and
  password reset have stricter limits. Tune the default with `RATELIMIT_DEFAULT`.

## Development without Docker

See [`backend/README.md`](backend/README.md) and
[`frontend/myschedule-web/README.md`](frontend/myschedule-web/README.md).

## CI

`.github/workflows/ci.yml` runs on every push and pull request: backend tests against
PostgreSQL and Redis, a migration run on an empty database, web lint/type-check/build,
both Docker image builds and a `docker compose config` check.
