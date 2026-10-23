import { NextResponse } from "next/server";
import { getRefreshToken, clearSessionCookies } from "@/lib/auth/session";

import { FLASK_URL } from "@/lib/auth/refresh";

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