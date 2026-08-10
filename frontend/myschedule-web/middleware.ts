import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
    const hasSession = req.cookies.has("myschedule_access") || req.cookies.has("myschedule_refresh");

    if (!hasSession && (req.nextUrl.pathname.startsWith("/manager") || req.nextUrl.pathname.startsWith("/employee"))) {
        return NextResponse.redirect(new URL("/login", req.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/manager/:path*", "/employee/:path*"],
};