import { NextResponse } from "next/server";
import { getRefreshToken, setSessionCookies, clearSessionCookies } from "@/lib/auth/session";

const FLASK_URL = process.env.FLASK_API_URL ?? "http://localhost:5000";

export async function POST() {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
        return NextResponse.json({ error: "No refresh token" }, { status: 401 });
    }

    const flaskRes = await fetch(`${FLASK_URL}/auth/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
    });

    if (!flaskRes.ok) {
        await clearSessionCookies();
        return NextResponse.json({ error: "Refresh failed" }, { status: 401 });
    }

    const data = await flaskRes.json();
    await setSessionCookies(data.access_token); // refresh token unchanged — Flask doesn't rotate it
    return NextResponse.json({ ok: true });
}