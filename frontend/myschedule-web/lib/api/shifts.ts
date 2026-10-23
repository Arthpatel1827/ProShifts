import { api, qs } from "./client";
import type { Shift, LaborCost, RoleWithStaff, ShiftInput, ShiftStatus } from "@/lib/types";

export async function listShifts(
    locationId: number,
    weekStart: string,
    status?: ShiftStatus
): Promise<Shift[]> {
    const res = await api.get<{ shifts: Shift[] }>(
        `/shifts/${qs({ location_id: locationId, week_start: weekStart, status })}`
    );
    return res.shifts;
}

export async function getShift(shiftId: number): Promise<Shift> {
    const res = await api.get<{ shift: Shift }>(`/shifts/${shiftId}`);
    return res.shift;
}

export async function createShift(input: ShiftInput): Promise<Shift> {
    const res = await api.post<{ shift: Shift }>("/shifts/", input);
    return res.shift;
}

export async function updateShift(
    shiftId: number,
    input: Partial<Omit<ShiftInput, "location_id">>
): Promise<Shift> {
    const res = await api.put<{ shift: Shift }>(`/shifts/${shiftId}`, input);
    return res.shift;
}

/** DELETE /shifts/:id cancels the shift (status → cancelled); it is not a hard delete. */
export async function cancelShift(shiftId: number): Promise<Shift> {
    const res = await api.delete<{ shift: Shift }>(`/shifts/${shiftId}`);
    return res.shift;
}

export async function assignUser(shiftId: number, userId: number): Promise<void> {
    await api.post(`/shifts/${shiftId}/assign`, { user_id: userId });
}

export async function unassignUser(shiftId: number, userId: number): Promise<void> {
    await api.delete(`/shifts/${shiftId}/assign`, { user_id: userId });
}

export async function getLaborCost(locationId: number, weekStart: string): Promise<LaborCost> {
    return api.get<LaborCost>(`/shifts/labor-cost${qs({ location_id: locationId, week_start: weekStart })}`);
}

export async function publishWeek(locationId: number, weekStart: string): Promise<number> {
    const res = await api.post<{ published_count: number }>("/shifts/publish", {
        location_id: locationId,
        week_start: weekStart,
    });
    return res.published_count;
}

export async function rolesWithStaff(locationId: number): Promise<RoleWithStaff[]> {
    const res = await api.get<{ roles: RoleWithStaff[] }>(
        `/shifts/roles-with-staff${qs({ location_id: locationId })}`
    );
    return res.roles;
}
