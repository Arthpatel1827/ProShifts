"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { useManager } from "./manager-context";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { MapPin } from "lucide-react";
import { TimezoneNotice } from "./location-timezone";

export function ManagerShell({ children }: { children: React.ReactNode }) {
    const [navOpen, setNavOpen] = useState(false);
    const { ready, error, location, locations } = useManager();

    let content: React.ReactNode = children;
    if (error) {
        content = <ErrorState message={error.message} onRetry={() => window.location.reload()} />;
    } else if (!ready) {
        content = (
            <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    } else if (!locations.length) {
        content = (
            <EmptyState
                icon={MapPin}
                title="No locations yet"
                description="Your account isn't linked to an active location. Ask your company owner to add you."
            />
        );
    } else if (!location) {
        content = <Skeleton className="h-64 w-full" />;
    }

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <TopBar onMenu={() => setNavOpen(true)} />
                <main className="flex-1 overflow-y-auto p-4 sm:p-6">
                    {ready && location && <TimezoneNotice />}
                    {content}
                </main>
            </div>
        </div>
    );
}
