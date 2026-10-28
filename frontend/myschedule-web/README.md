# ProShifts — manager web app

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui on Base UI.

For owners, managers and supervisors: dashboard, schedule, team, analytics, requests
and messaging. Staff use the mobile app (clock-in needs GPS, geofencing and biometrics).

## Run locally

Start the Flask API first (see `backend/README.md`), then:

```bash
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
```

| Variable | Where it's used |
| --- | --- |
| `FLASK_API_URL` | Server-side: where the Next.js routes reach Flask |
| `NEXT_PUBLIC_SOCKET_URL` | Browser: Socket.IO endpoint. Unset → the page's own origin (the Docker/Caddy setup); set to `http://localhost:5000` for local dev. Baked in at build time |
| `COOKIE_SECURE` | Session cookies are `Secure` in production; `false` only for a plain-HTTP trial |

In Docker the app runs as a standalone server (`output: "standalone"`) behind Caddy; see
the root README.

Add the web origin (e.g. `http://localhost:3000`) to the backend's `CORS_ORIGINS` so the
browser can open its socket.

## How auth works

The browser never sees the JWTs. `app/api/auth/*` sets them as httpOnly cookies and
`app/api/proxy/[...path]` forwards every API call to Flask with the access token. When it
expires, the proxy refreshes it once — concurrent requests share a single refresh — and
retries. Socket.IO is the one exception: `/api/auth/socket-token` hands the short-lived
access token to the socket handshake.

`proxy.ts` (Next 16's renamed middleware) only redirects signed-out visitors to `/login`;
Flask enforces all real authorization.

## Layout

- `app/manager/*/page.tsx`: thin route files that render `components/manager/<section>`.
- `lib/api/*`: one module per backend area; every call goes through `lib/api/client.ts`.
- `lib/hooks/use-query.ts`: small data-fetching hook (no extra state library).
- `lib/hooks/use-socket.ts`: a single shared Socket.IO connection with room membership.
- `lib/format.ts`: every date/time conversion. Shift times are sent with the browser's
  UTC offset; record timestamps (`created_at`) are naive UTC.

## Checks

```bash
npx eslint . && npx tsc --noEmit && npm run build
```
