"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Calendar,
    Users,
    BarChart3,
    ListChecks,
    MessageSquare,
    Settings,
    Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useManager } from "./manager-context";

const NAV_ITEMS = [
    { href: "/manager/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/manager/schedule", label: "Schedule", icon: Calendar },
    { href: "/manager/timesheets", label: "Timesheets", icon: Clock },
    { href: "/manager/team", label: "Team", icon: Users },
    { href: "/manager/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/manager/requests", label: "Requests", icon: ListChecks, badge: "pending" as const },
    { href: "/manager/messaging", label: "Messaging", icon: MessageSquare },
    { href: "/manager/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
    const pathname = usePathname();
    const { pending } = useManager();

    return (
        <>
            {/* Mobile scrim */}
            <div
                onClick={onNavigate}
                aria-hidden
                className={cn(
                    "fixed inset-0 z-30 bg-black/30 transition-opacity lg:hidden",
                    open ? "opacity-100" : "pointer-events-none opacity-0"
                )}
            />
            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0",
                    open ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="flex h-16 items-center gap-2 px-6">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                        P
                    </span>
                    <span className="text-lg font-semibold text-foreground">ProShifts</span>
                </div>

                <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Manager navigation">
                    {NAV_ITEMS.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        const Icon = item.icon;
                        const count = item.badge === "pending" ? pending?.total ?? 0 : 0;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={onNavigate}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                    isActive
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                <span className="flex-1">{item.label}</span>
                                {count > 0 && (
                                    <span
                                        className={cn(
                                            "min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums",
                                            isActive ? "bg-primary-foreground/20" : "bg-primary text-primary-foreground"
                                        )}
                                        aria-label={`${count} pending`}
                                    >
                                        {count > 99 ? "99+" : count}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <p className="px-6 pb-5 text-[11px] leading-relaxed text-muted-foreground">
                    Staff clock in from the ProShifts mobile app.
                </p>
            </aside>
        </>
    );
}
