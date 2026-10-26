import { api } from "./client";
import type { ClockSettings } from "@/lib/types";

export async function getClockSettings(): Promise<ClockSettings> {
    const res = await api.get<{ settings: ClockSettings }>("/time-entries/settings");
    return res.settings;
}

/** Owners and managers only. max_breaks_per_shift: 0 means unlimited. */
export async function updateClockSettings(
    update: Partial<Omit<ClockSettings, "pin_expires_at">>
): Promise<ClockSettings> {
    const res = await api.put<{ settings: ClockSettings }>("/time-entries/settings", update);
    return res.settings;
}

/** Owners and managers only. The PIN is returned once; it is stored hashed. */
export async function generatePin(): Promise<string> {
    const res = await api.post<{ pin: string }>("/time-entries/settings/generate-pin");
    return res.pin;
}
