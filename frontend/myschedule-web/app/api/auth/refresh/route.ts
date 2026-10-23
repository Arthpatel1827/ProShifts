import { NextResponse } from "next/server";
import { getRefreshToken, setSessionCookies, clearSessionCookies } from "@/lib/auth/session";
import { refreshAccessToken } from "@/lib/auth/refresh";

export async function POST() {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
        return NextResponse.json({ error: "No refresh token" }, { status: 401 });
    }

    const accessToken = await refreshAccessToken(refreshToken);
    if (!accessToken) {
        await clearSessionCookies();
        return NextResponse.json({ error: "Refresh failed" }, { status: 401 });
    }

    await setSessionCookies(accessToken); // refresh token unchanged — Flask doesn't rotate it
    return NextResponse.json({ ok: true });
}
