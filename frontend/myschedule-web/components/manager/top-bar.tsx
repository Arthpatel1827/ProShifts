"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Globe, LogOut, Menu, MapPin } from "lucide-react";
import { LocationTimezoneDialog } from "./location-timezone";
import { logout } from "@/lib/api/auth";
import { Avatar } from "@/components/ui/primitives";
import { useManager } from "./manager-context";

const PAGE_TITLES: Record<string, string> = {
    "/manager/dashboard": "Dashboard",
    "/manager/schedule": "Schedule",
    "/manager/team": "Team",
    "/manager/analytics": "Analytics",
    "/manager/requests": "Requests",
    "/manager/messaging": "Messaging",
};

export function TopBar({ onMenu }: { onMenu: () => void }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, locations, location, setLocationId, timezone, canApprove } = useManager();
    const [tzOpen, setTzOpen] = useState(false);

    const title = Object.entries(PAGE_TITLES).find(([path]) => pathname.startsWith(path))?.[1] ?? "";
    const name = user?.display_name || user?.username || "";

    async function handleLogout() {
        await logout();
        router.push("/login");
    }

    return (
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
                <button
                    onClick={onMenu}
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
                    aria-label="Open navigation"
                >
                    <Menu className="h-5 w-5" />
                </button>
                <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
                {locations.length > 1 ? (
                    <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="sr-only">Location</span>
                        <select
                            value={location?.id ?? ""}
                            onChange={(e) => setLocationId(Number(e.target.value))}
                            className="max-w-40 bg-transparent outline-none"
                        >
                            {locations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                    {loc.name}
                                </option>
                            ))}
                        </select>
                    </label>
                ) : location ? (
                    <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
                        <MapPin className="h-3.5 w-3.5" />
                        {location.name}
                    </span>
                ) : null}

                {location && (
                    <button
                        onClick={canApprove ? () => setTzOpen(true) : undefined}
                        disabled={!canApprove}
                        title={canApprove ? "Change the location's timezone" : "Location timezone"}
                        className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground lg:flex"
                    >
                        <Globe className="h-3.5 w-3.5" />
                        {timezone.replace(/_/g, " ")}
                    </button>
                )}

                {name && (
                    <div className="hidden items-center gap-2 md:flex">
                        <Avatar name={name} />
                        <div className="leading-tight">
                            <p className="text-sm font-medium text-foreground">{name}</p>
                            <p className="text-xs capitalize text-muted-foreground">{user?.role}</p>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                    <LogOut className="h-4 w-4" />
                    <span className="hidden sm:inline">Sign out</span>
                </button>
            </div>
            <LocationTimezoneDialog open={tzOpen} onOpenChange={setTzOpen} />
        </header>
    );
}
