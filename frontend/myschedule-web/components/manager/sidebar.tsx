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
} from "lucide-react";

const NAV_ITEMS = [
    { href: "/manager/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/manager/schedule", label: "Schedule", icon: Calendar },
    { href: "/manager/team", label: "Team", icon: Users },
    { href: "/manager/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/manager/requests", label: "Requests", icon: ListChecks },
    { href: "/manager/messaging", label: "Messaging", icon: MessageSquare },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="flex w-60 flex-col border-r border-border bg-card">
            <div className="flex h-16 items-center px-6">
                <span className="text-lg font-semibold text-foreground">MySchedule</span>
            </div>

            <nav className="flex-1 space-y-1 px-3 py-4">
                {NAV_ITEMS.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                }`}
                        >
                            <Icon className="h-4 w-4" />
                            {item.label}
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
}