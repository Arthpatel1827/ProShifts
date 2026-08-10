import { apiFetch } from "./client";
import type { Shift, LaborCost } from "@/lib/types";

export async function listShifts(locationId: number, weekStart: string): Promise<Shift[]> {
    const res = await apiFetch<{ shifts: Shift[] }>(
        `/shifts/?location_id=${locationId}&week_start=${weekStart}`
    );
    return res.shifts;
}

export async function getLaborCost(locationId: number, weekStart: string): Promise<LaborCost> {
    return apiFetch<LaborCost>(`/shifts/labor-cost?location_id=${locationId}&week_start=${weekStart}`);
}

export async function publishWeek(locationId: number, weekStart: string): Promise<void> {
    await apiFetch(`/shifts/publish`, {
        method: "POST",
        body: JSON.stringify({ location_id: locationId, week_start: weekStart }),
    });
}