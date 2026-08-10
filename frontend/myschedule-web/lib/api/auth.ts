import type { User } from "@/lib/types";

export async function login(email: string, password: string): Promise<{ user: User }> {
    const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Login failed");
    return data;
}

export async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
}