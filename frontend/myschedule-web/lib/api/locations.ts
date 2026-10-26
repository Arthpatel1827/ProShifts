import { api, apiFetch } from "./client";
import type { Location } from "@/lib/types";

export async function listLocations(): Promise<Location[]> {
    const res = await apiFetch<{ locations: Location[] }>("/admin/locations");
    return res.locations;
}

/** Owners/managers only. Defines the location's calendar day for schedules and attendance. */
export async function updateLocationTimezone(locationId: number, timezone: string): Promise<void> {
    await api.put(`/admin/locations/${locationId}`, { timezone });
}
