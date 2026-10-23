import { api, ApiError } from "./client";
import type { User } from "@/lib/types";

export async function login(email: string, password: string): Promise<{ user: User }> {
    let res: Response;
    try {
        res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
    } catch {
        throw new ApiError("Can't reach the server. Check your connection and try again.", 0, null);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data?.error ?? "Login failed", res.status, data);
    return data;
}

export async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
}

export async function getCurrentUser(): Promise<User> {
    const res = await api.get<{ user: User }>("/auth/me");
    return res.user;
}
