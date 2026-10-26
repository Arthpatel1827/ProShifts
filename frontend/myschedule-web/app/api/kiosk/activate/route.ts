import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, KIOSK_COOKIE_OPTS } from "@/lib/auth/kiosk";

/** Turn this browser into the punch-in tablet (token from POST /kiosk/devices). */
export async function POST(req: NextRequest) {
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
        return NextResponse.json({ error: "Invalid tablet token" }, { status: 400 });
    }
    (await cookies()).set(KIOSK_COOKIE, token, KIOSK_COOKIE_OPTS);
    return NextResponse.json({ ok: true });
}

/** Stop using this browser as the tablet. */
export async function DELETE() {
    (await cookies()).delete(KIOSK_COOKIE);
    return NextResponse.json({ ok: true });
}
