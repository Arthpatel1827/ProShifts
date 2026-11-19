// src/utils/sessionEvents.ts
// The API layer (axios) and the auth state (React context) live in different places. When the
// server says the stored session is no good and a refresh can't fix it, the API layer calls
// emitSessionExpired() and AuthContext signs the user out — instead of leaving them on a
// screen where every request fails.

type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function emitSessionExpired(): void {
    listeners.forEach(l => { try { l(); } catch { /* one bad listener must not block the rest */ } });
}

/** Auth endpoints answer 401 for real reasons (wrong password, bad refresh token) — those are
 *  answers for the caller, not an expired session to "repair". */
export function isAuthEndpoint(url?: string): boolean {
    return /\/auth\/(login|register|refresh|forgot-password)/.test(url ?? '');
}

/**
 * True when the server rejected the *credentials we sent* rather than the request itself:
 *  - 401: missing / expired / revoked token
 *  - 422 "Invalid token.": malformed token or one signed with a different secret (for example
 *    tokens kept on the phone from an older server). flask-jwt-extended uses 422 for this, and
 *    the app used to treat only 401 as recoverable, so it stayed "signed in" with nothing loading.
 */
export function isSessionRejected(e: any): boolean {
    const status = e?.response?.status;
    if (status === 401) return true;
    return status === 422 && /invalid token/i.test(String(e?.response?.data?.error ?? ''));
}
