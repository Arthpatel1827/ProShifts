// lib/api/client.ts
// Browser-side fetch wrapper. Every call goes through the Next.js /api/proxy route,
// which attaches the httpOnly access token and refreshes it on 401.

export class ApiError extends Error {
    status: number;
    code?: string;
    body: unknown;

    constructor(message: string, status: number, body: unknown) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
        if (body && typeof body === "object" && "code" in body) {
            this.code = String((body as { code: unknown }).code);
        }
    }
}

async function readBody(res: Response): Promise<unknown> {
    if (res.status === 204 || res.status === 205) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
        return res.json().catch(() => null);
    }
    const text = await res.text();
    return text.length ? text : null;
}

function messageFrom(body: unknown, status: number): string {
    // Flask-Limiter's own text ("50 per 1 hour") means nothing to a manager.
    if (status === 429) return "Too many requests right now. Wait a moment and try again.";
    if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (typeof b.error === "string") return b.error;
        if (typeof b.message === "string") return b.message;
    }
    if (typeof body === "string" && body.length < 200) return body;
    if (status === 401) return "Your session has expired. Please sign in again.";
    if (status === 403) return "You don't have permission to do that.";
    if (status >= 500) return "Something went wrong on our side. Please try again.";
    return `Request failed (${status})`;
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`/api/proxy${path.startsWith("/") ? path : `/${path}`}`, {
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...options.headers,
            },
        });
    } catch {
        throw new ApiError("Can't reach the server. Check your connection and try again.", 0, null);
    }

    const body = await readBody(res);

    if (res.status === 401 && typeof window !== "undefined") {
        // The proxy already tried to refresh. The session is gone — send them to sign in.
        // A full page load (not router.push) deliberately drops all in-memory state for the old session.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }

    if (!res.ok) throw new ApiError(messageFrom(body, res.status), res.status, body);
    return body as T;
}

export const api = {
    get: <T>(path: string) => apiFetch<T>(path),
    post: <T>(path: string, body?: unknown) =>
        apiFetch<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
    put: <T>(path: string, body?: unknown) =>
        apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
    patch: <T>(path: string, body?: unknown) =>
        apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
    delete: <T>(path: string, body?: unknown) =>
        apiFetch<T>(path, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) }),
};

/** Builds a query string, skipping null/undefined values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined && v !== "") search.set(k, String(v));
    }
    const s = search.toString();
    return s ? `?${s}` : "";
}
