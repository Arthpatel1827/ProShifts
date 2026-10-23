import { NextRequest, NextResponse } from "next/server";

// Next.js 16 renamed the `middleware` convention to `proxy`.
// Session check here is only a fast redirect; the Flask API enforces real authorization.
export function proxy(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // With skipTrailingSlashRedirect on, keep page URLs canonical ourselves.
    // /api/proxy/* is excluded so trailing slashes reach Flask unchanged.
    if (pathname.length > 1 && pathname.endsWith("/") && !pathname.startsWith("/api/")) {
        // A plain URL: NextURL.clone() re-applies the trailing slash and would loop.
        const url = new URL(req.url);
        url.pathname = pathname.replace(/\/+$/, "");
        return NextResponse.redirect(url, 308);
    }

    if (pathname.startsWith("/manager") || pathname.startsWith("/employee")) {
        const hasSession = req.cookies.has("myschedule_access") || req.cookies.has("myschedule_refresh");
        if (!hasSession) {
            const url = new URL("/login", req.url);
            url.searchParams.set("next", pathname);
            return NextResponse.redirect(url);
        }
    }

    return NextResponse.next();
}

export const config = {
    // Everything except static assets.
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
