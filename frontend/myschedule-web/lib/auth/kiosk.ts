// The punch-in tablet's device token lives in an httpOnly cookie: page scripts never
// see it, and no employee account is signed in on the shared tablet.
export const KIOSK_COOKIE = "proshifts_kiosk";
export const KIOSK_COOKIE_OPTS = {
    httpOnly: true,
    // Same rule as the session cookies (lib/auth/session.ts): COOKIE_SECURE=false only
    // for a plain-HTTP trial run.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
};
