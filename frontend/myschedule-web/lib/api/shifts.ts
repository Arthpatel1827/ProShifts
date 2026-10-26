import { ApiError, api, qs } from "./client";
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

/** Rejected with code OUTSIDE_AVAILABILITY (409) when the person isn't available then;
 *  call again with allowOutsideAvailability once the manager confirms. */
export async function assignUser(shiftId: number, userId: number, allowOutsideAvailability = false): Promise<void> {
    await api.post(`/shifts/${shiftId}/assign`, { user_id: userId, allow_outside_availability: allowOutsideAvailability });
}

export function isOutsideAvailability(err: unknown): err is ApiError {
    return err instanceof ApiError && err.code === "OUTSIDE_AVAILABILITY";
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

export type BulkRow = {
    user_id: number;
    role_id: number | null;
    start_time: string; // "HH:MM" at the location
    end_time: string;
    days: number[]; // 0 = Monday … 6 = Sunday
    break_minutes: number;
};

export type BulkResult = {
    created_count: number;
    created_ids: number[];
    skipped: { index: number; user_id?: number; day?: string; reason: string; code?: string }[];
};

/** Creates one draft shift per person per selected day; conflicts are skipped and reported. */
export function bulkCreateWeek(locationId: number, weekStart: string, rows: BulkRow[], allowOutsideAvailability = false): Promise<BulkResult> {
    return api.post<BulkResult>("/shifts/bulk-week", {
        location_id: locationId,
        week_start: weekStart,
        rows,
        allow_outside_availability: allowOutsideAvailability,
    });
}

export type CopyResult = {
    created_count: number;
    created_ids: number[];
    /** Existing open shifts in the same slot that received the copied staff. */
    filled_count: number;
    filled_ids: number[];
    skipped: { index: number; shift_id?: number; date?: string; reason: string }[];
    /** Staff who couldn't be carried over; their copied shift was left open. */
    unassigned: { shift_id: number; user_id: number; name: string | null; date: string; reason: string }[];
};

/** Copies shifts to other dates (same wall-clock times) as drafts. */
export function copyShifts(
    locationId: number,
    items: { shift_id: number; date: string }[],
    includeAssignees: boolean,
    allowOutsideAvailability = false
): Promise<CopyResult> {
    return api.post<CopyResult>("/shifts/copy", {
        location_id: locationId,
        items,
        include_assignees: includeAssignees,
        allow_outside_availability: allowOutsideAvailability,
    });
}
