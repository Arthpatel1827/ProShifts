import { cookies } from "next/headers";

const ACCESS_COOKIE = "myschedule_access";
const REFRESH_COOKIE = "myschedule_refresh";

const cookieOpts = {
    httpOnly: true,
    // Secure in production. COOKIE_SECURE=false allows a plain-HTTP trial run
    // (e.g. docker compose on http://localhost); never disable it behind HTTPS.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
};

export async function setSessionCookies(accessToken: string, refreshToken?: string) {
    const store = await cookies();
    store.set(ACCESS_COOKIE, accessToken, { ...cookieOpts, maxAge: 60 * 15 }); // 15 min
    if (refreshToken) {
        store.set(REFRESH_COOKIE, refreshToken, { ...cookieOpts, maxAge: 60 * 60 * 24 * 30 }); // 30 days
    }
}

export async function getAccessToken(): Promise<string | undefined> {
    const store = await cookies();
    return store.get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
    const store = await cookies();
    return store.get(REFRESH_COOKIE)?.value;
}

export async function clearSessionCookies() {
    const store = await cookies();
    store.delete(ACCESS_COOKIE);
    store.delete(REFRESH_COOKIE);
}