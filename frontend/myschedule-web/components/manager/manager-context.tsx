"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "@/lib/api/auth";
import { listLocations } from "@/lib/api/locations";
import { getPendingCounts, type PendingCounts } from "@/lib/api/requests";
import { useQuery } from "@/lib/hooks/use-query";
import { APPROVER_ROLES, MANAGER_ROLES } from "@/lib/theme/tokens";
import { safeTz } from "@/lib/format";
import type { Location, User } from "@/lib/types";

const LOCATION_STORAGE_KEY = "myschedule.locationId";
const PENDING_REFRESH_MS = 60_000;

type ManagerContextValue = {
    user: User | null;
    locations: Location[];
    location: Location | null;
    /** IANA timezone of the selected location; every schedule date/time uses it. */
    timezone: string;
    setLocationId: (id: number) => void;
    refreshLocations: () => Promise<void>;
    /** Owners and managers can approve requests; supervisors can view them. */
    canApprove: boolean;
    pending: PendingCounts | undefined;
    refreshPending: () => Promise<void>;
    ready: boolean;
    error: Error | null;
};

const ManagerContext = createContext<ManagerContextValue | null>(null);

function readStoredLocation(): number | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
        return raw ? Number(raw) : null;
    } catch {
        return null;
    }
}

export function ManagerProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const me = useQuery(["me"], getCurrentUser);
    const locs = useQuery(["locations"], listLocations);
    // Explicit choice made this session; otherwise derived from storage / home location.
    const [chosenId, setChosenId] = useState<number | null>(null);

    // Staff accounts have nothing to do here — the backend would 403 every call anyway.
    useEffect(() => {
        const role = me.data?.role?.toLowerCase();
        if (me.data && !MANAGER_ROLES.includes(role as (typeof MANAGER_ROLES)[number])) {
            router.replace("/employee");
        }
    }, [me.data, router]);

    // Pick the chosen location, then the stored one, then the user's home location, then the first.
    const locationId = useMemo(() => {
        if (!locs.data?.length) return null;
        const ids = new Set(locs.data.map((l) => l.id));
        const candidates = [chosenId, readStoredLocation(), me.data?.location_id ?? null];
        return candidates.find((id): id is number => id !== null && ids.has(id)) ?? locs.data[0].id;
    }, [locs.data, me.data, chosenId]);

    const setLocationId = useCallback((id: number) => {
        setChosenId(id);
        try {
            window.localStorage.setItem(LOCATION_STORAGE_KEY, String(id));
        } catch {
            /* storage unavailable — selection still works for this session */
        }
    }, []);

    const location = useMemo(
        () => locs.data?.find((l) => l.id === locationId) ?? null,
        [locs.data, locationId]
    );

    const pending = useQuery(
        locationId ? ["pending", locationId] : null,
        () => getPendingCounts(locationId!),
        { refreshMs: PENDING_REFRESH_MS }
    );

    const role = me.data?.role?.toLowerCase() ?? "";
    const value: ManagerContextValue = {
        user: me.data ?? null,
        locations: locs.data ?? [],
        location,
        timezone: safeTz(location?.timezone),
        setLocationId,
        refreshLocations: locs.refetch,
        canApprove: APPROVER_ROLES.includes(role as (typeof APPROVER_ROLES)[number]),
        pending: pending.data,
        refreshPending: pending.refetch,
        ready: !!me.data && !!locs.data,
        error: me.error ?? locs.error,
    };

    return <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>;
}

export function useManager(): ManagerContextValue {
    const ctx = useContext(ManagerContext);
    if (!ctx) throw new Error("useManager must be used inside <ManagerProvider>");
    return ctx;
}
