// Server-side only: imported by route handlers, never by client components.
export const FLASK_URL = process.env.FLASK_API_URL ?? "http://localhost:5000";

// When several requests 401 at once (a dashboard fires five in parallel), they must not
// each call /auth/refresh. Concurrent callers holding the same refresh token share one
// in-flight request. Keyed by token so different users never share a result.
const inflight = new Map<string, Promise<string | null>>();

/** Returns a new access token, or null if the refresh token is invalid/revoked. */
export function refreshAccessToken(refreshToken: string): Promise<string | null> {
    const existing = inflight.get(refreshToken);
    if (existing) return existing;

    const promise = (async () => {
        try {
            const res = await fetch(`${FLASK_URL}/auth/refresh`, {
                method: "POST",
                headers: { Authorization: `Bearer ${refreshToken}` },
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
