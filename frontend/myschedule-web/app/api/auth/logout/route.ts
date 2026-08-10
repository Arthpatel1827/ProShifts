import { NextResponse } from "next/server";
import { getRefreshToken, clearSessionCookies } from "@/lib/auth/session";

const FLASK_URL = process.env.FLASK_API_URL ?? "http://localhost:5000";

export async function POST() {
    const refreshToken = await getRefreshToken();

    if (refreshToken) {
        // Best-effort — revoke server-side, but clear our cookies regardless of outcome
        await fetch(`${FLASK_URL}/auth/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${refreshToken}` },
        }).catch(() => { });
    }

    await clearSessionCookies();
    return NextResponse.json({ ok: true });
}