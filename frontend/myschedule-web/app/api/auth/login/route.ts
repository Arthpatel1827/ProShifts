import { NextRequest, NextResponse } from "next/server";
import { setSessionCookies } from "@/lib/auth/session";

import { FLASK_URL, forwardedHeaders } from "@/lib/auth/refresh";

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    if (!body?.email || !body?.password) {
        return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    let flaskRes: Response;
    try {
        flaskRes = await fetch(`${FLASK_URL}/auth/login`, {
            method: "POST",
            headers: { ...forwardedHeaders(req), "Content-Type": "application/json" },
            body: JSON.stringify({ email: body.email, password: body.password }),
            cache: "no-store",
        });
    } catch {
        return NextResponse.json({ error: "The ProShifts API is unreachable. Try again shortly." }, { status: 502 });
    }

    const data = await flaskRes.json().catch(() => ({}));

    if (!flaskRes.ok) {
        // Pass Flask's actual error straight through — including the
        // EMAIL_NOT_VERIFIED code, so the login page can handle it specifically.
        return NextResponse.json(data, { status: flaskRes.status });
    }

    await setSessionCookies(data.access_token, data.refresh_token);

    // Never send raw tokens back to the browser — only the user object.
    return NextResponse.json({ user: data.user });
}