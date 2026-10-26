import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { FLASK_URL } from "@/lib/auth/refresh";
import { KIOSK_COOKIE } from "@/lib/auth/kiosk";

// Only the two tablet endpoints; everything else needs a signed-in manager.
const ALLOWED: Record<string, "GET" | "POST"> = { session: "GET", punch: "POST" };

async function forward(req: NextRequest, action: string) {
    if (ALLOWED[action] !== req.method) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const token = (await cookies()).get(KIOSK_COOKIE)?.value;
    if (!token) return NextResponse.json({ error: "This tablet isn't set up. Ask a manager." }, { status: 401 });
    try {
        const res = await fetch(`${FLASK_URL}/kiosk/${action}`, {
            method: req.method,
            headers: { "Content-Type": "application/json", "X-Kiosk-Token": token },
            body: req.method === "POST" ? await req.text() : undefined,
            cache: "no-store",
        });
        const text = await res.text();
        return new NextResponse(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
    } catch {
        return NextResponse.json({ error: "Can't reach ProShifts right now." }, { status: 502 });
    }
}

type Ctx = { params: Promise<{ action: string }> };
export async function GET(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).action);
}
export async function POST(req: NextRequest, { params }: Ctx) {
    return forward(req, (await params).action);
}
