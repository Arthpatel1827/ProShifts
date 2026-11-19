import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, getRefreshToken, setSessionCookies, clearSessionCookies } from "@/lib/auth/session";
import { FLASK_URL, forwardedHeaders, refreshAccessToken } from "@/lib/auth/refresh";

// Response headers worth passing back to the browser. Everything else (cookies,
// hop-by-hop headers, Flask's server header) stays on this side.
const PASS_RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "etag", "last-modified"];

async function callFlask(req: NextRequest, path: string[], body: ArrayBuffer | undefined, token: string | undefined) {
    const headers = new Headers(forwardedHeaders(req));
    const contentType = req.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType); // keeps multipart boundaries intact
    const accept = req.headers.get("accept");
    if (accept) headers.set("Accept", accept);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    // Keep a trailing slash if the caller sent one: Flask's collection routes are /shifts/, /drops/…
    const slash = req.nextUrl.pathname.endsWith("/") ? "/" : "";
    return fetch(`${FLASK_URL}/${path.map(encodeURIComponent).join("/")}${slash}${req.nextUrl.search}`, {
        method: req.method,
        headers,
        body,
        cache: "no-store",
        // Flask may still 308 between /x and /x/ for routes called without the slash.
        redirect: "follow",
    });
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
    // Read the body once — a stream can't be replayed for the retry after refresh.
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    const refreshToken = await getRefreshToken();
    let accessToken = await getAccessToken();

    // The access cookie expired but the session is still alive: refresh up front.
    if (!accessToken && refreshToken) {
        accessToken = (await refreshAccessToken(refreshToken, forwardedHeaders(req))) ?? undefined;
        if (accessToken) await setSessionCookies(accessToken);
    }

    let flaskRes: Response;
    try {
        flaskRes = await callFlask(req, path, body, accessToken);
        if (flaskRes.status === 401 && refreshToken) {
            const fresh = await refreshAccessToken(refreshToken, forwardedHeaders(req));
            if (fresh) {
                await setSessionCookies(fresh);
                flaskRes = await callFlask(req, path, body, fresh); // retry exactly once
            }
        }
    } catch {
        return NextResponse.json({ error: "The ProShifts API is unreachable." }, { status: 502 });
    }

    if (flaskRes.status === 401) await clearSessionCookies();

    const headers = new Headers();
    for (const name of PASS_RESPONSE_HEADERS) {
        const value = flaskRes.headers.get(name);
        if (value) headers.set(name, value);
    }

    // 204/304 must not carry a body; everything else (JSON, text, files) streams through unchanged.
    const noBody = flaskRes.status === 204 || flaskRes.status === 304 || req.method === "HEAD";
    return new NextResponse(noBody ? null : flaskRes.body, { status: flaskRes.status, headers });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).path);
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).path);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).path);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).path);
}
