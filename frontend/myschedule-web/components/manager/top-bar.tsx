"use client";

import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/api/auth";

const PAGE_TITLES: Record<string, string> = {
    "/manager/dashboard": "Dashboard",
    "/manager/schedule": "Schedule",
    "/manager/team": "Team",
    "/manager/analytics": "Analytics",
    "/manager/requests": "Requests",
    "/manager/messaging": "Messaging",
};

export function TopBar() {
    const pathname = usePathname();
    const router = useRouter();

    const title =
        Object.entries(PAGE_TITLES).find(([path]) => pathname.startsWith(path))?.[1] ?? "";

    async function handleLogout() {
        await logout();
        router.push("/login");
    }

    return (
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>

            <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
                <LogOut className="h-4 w-4" />
                Sign out
            </button>
        </header>
    );
}