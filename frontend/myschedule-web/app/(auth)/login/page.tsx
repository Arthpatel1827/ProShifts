"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MailWarning } from "lucide-react";
import { login } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { MANAGER_ROLES } from "@/lib/theme/tokens";

/** Only allow same-site manager paths, so ?next= can't be used as an open redirect. */
function safeNext(): string | null {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && /^\/manager(\/[\w-]*)*$/.test(next) ? next : null;
}

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setUnverifiedEmail(null);
        setLoading(true);
        try {
            const { user } = await login(email.trim(), password);
            const roleName = String(user.role ?? "").toLowerCase();
            const isManager = (MANAGER_ROLES as readonly string[]).includes(roleName);
            router.push(isManager ? safeNext() ?? "/manager/dashboard" : "/employee");
        } catch (err) {
            if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
                setUnverifiedEmail(email.trim());
            } else {
                setError(err instanceof Error ? err.message : "Login failed");
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="w-full max-w-sm space-y-6">
                <div className="space-y-1 text-center">
                    <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
                        M
                    </span>
                    <h1 className="text-2xl font-semibold text-foreground">MySchedule</h1>
                    <p className="text-sm text-muted-foreground">Sign in to manage your team</p>
                </div>

                {unverifiedEmail && (
                    <div
                        role="alert"
                        className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
                    >
                        <MailWarning className="mt-0.5 size-5 shrink-0 text-warning" />
                        <div className="space-y-1">
                            <p className="font-medium text-foreground">Verify your email to continue</p>
                            <p className="text-muted-foreground">
                                We sent a verification link to <span className="font-medium text-foreground">{unverifiedEmail}</span>{" "}
                                when your account was created. Open it, then sign in again. The link expires after 24
                                hours — if it has, contact your company owner or MySchedule support.
                            </p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="email" className="text-sm font-medium text-foreground">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </div>

                    <div className="space-y-2">
                        <label htmlFor="password" className="text-sm font-medium text-foreground">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {loading ? "Signing in…" : "Sign in"}
                    </button>
                </form>

                <p className="text-center text-xs text-muted-foreground">
                    Forgot your password? Reset it from the MySchedule mobile app.
                </p>
            </div>
        </div>
    );
}
