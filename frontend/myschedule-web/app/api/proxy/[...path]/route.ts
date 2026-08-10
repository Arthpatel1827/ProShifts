import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, getRefreshToken, setSessionCookies, clearSessionCookies } from "@/lib/auth/session";

const FLASK_URL = process.env.FLASK_API_URL ?? "http://localhost:5000";

async function forward(req: NextRequest, path: string[], retry = true): Promise<NextResponse> {
    const accessToken = await getAccessToken();
    const search = req.nextUrl.search;
    const target = `${FLASK_URL}/${path.join("/")}${search}`;

    const init: RequestInit = {
        method: req.method,
        headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = await req.text();
    }

    const flaskRes = await fetch(target, init);

    if (flaskRes.status === 401 && retry) {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
            const refreshRes = await fetch(`${FLASK_URL}/auth/refresh`, {
                method: "POST",
                headers: { Authorization: `Bearer ${refreshToken}` },
            });
            if (refreshRes.ok) {
                const data = await refreshRes.json();
                await setSessionCookies(data.access_token);
                return forward(req, path, false); // retry exactly once
            }
        }
        await clearSessionCookies();
    }

    const data = await flaskRes.json().catch(() => null);
    return NextResponse.json(data, { status: flaskRes.status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return forward(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return forward(req, (await params).path);
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return forward(req, (await params).path);
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return forward(req, (await params).path);
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return forward(req, (await params).path);
}