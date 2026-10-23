import { NextResponse } from "next/server";
import { getAccessToken, getRefreshToken, setSessionCookies } from "@/lib/auth/session";
import { refreshAccessToken } from "@/lib/auth/refresh";

// The Socket.IO handshake must carry the JWT, but the browser can't read our httpOnly
// cookies. This hands the *access* token (never the refresh token) to the same-origin
// page for the socket only. POST keeps it out of caches and link prefetching.
export async function POST() {
    let token = await getAccessToken();
    if (!token) {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
            const fresh = await refreshAccessToken(refreshToken);
            if (fresh) {
                await setSessionCookies(fresh);
                token = fresh;
            }
        }
    }
    if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
