// Server-side only: imported by route handlers, never by client components.
export const FLASK_URL = process.env.FLASK_API_URL ?? "http://localhost:5000";

/**
 * Headers that tell Flask who the real client is. Behind Caddy (docker-compose), Caddy
 * sets X-Forwarded-For to the client IP; we pass it on so Flask's per-IP login limits
 * apply to the user, not to this Next.js server. Flask only trusts these when
 * TRUSTED_PROXY_COUNT is set, so forwarding them is harmless elsewhere.
 */
export function forwardedHeaders(req: { headers: Headers }): Record<string, string> {
    const out: Record<string, string> = {};
    const xff = req.headers.get("x-forwarded-for");
    // Only the hop our proxy appended is trustworthy — earlier entries are client-supplied.
    const client = xff?.split(",").pop()?.trim() || req.headers.get("x-real-ip") || "";
    if (client) out["X-Forwarded-For"] = client;
    const proto = req.headers.get("x-forwarded-proto");
    if (proto) out["X-Forwarded-Proto"] = proto;
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host) out["X-Forwarded-Host"] = host;
    return out;
}

// When several requests 401 at once (a dashboard fires five in parallel), they must not
// each call /auth/refresh. Concurrent callers holding the same refresh token share one
// in-flight request. Keyed by token so different users never share a result.
const inflight = new Map<string, Promise<string | null>>();

/** Returns a new access token, or null if the refresh token is invalid/revoked. */
export function refreshAccessToken(
    refreshToken: string,
    extraHeaders: Record<string, string> = {}
): Promise<string | null> {
    const existing = inflight.get(refreshToken);
    if (existing) return existing;

    const promise = (async () => {
        try {
            const res = await fetch(`${FLASK_URL}/auth/refresh`, {
                method: "POST",
                headers: { ...extraHeaders, Authorization: `Bearer ${refreshToken}` },
                cache: "no-store",
            });
            if (!res.ok) return null;
            const data = (await res.json()) as { access_token?: string };
            return data.access_token ?? null;
        } catch {
            return null;
        } finally {
            // Keep the result briefly so requests that 401'd a moment later reuse it too.
            setTimeout(() => inflight.delete(refreshToken), 2_000);
        }
    })();

    inflight.set(refreshToken, promise);
    return promise;
}
