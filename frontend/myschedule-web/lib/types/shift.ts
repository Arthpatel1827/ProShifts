export type ShiftStatus = "draft" | "published" | "cancelled";

export type ShiftAssignment = {
    user_id: number;
    assigned_at: string;
};

/** Shape returned by ShiftService.serialize. Times are naive ISO strings (no offset). */
export type Shift = {
    shift_id: number;
    location_id: number;
    role?: string | null;
    start_time: string;
    end_time: string;
    break_minutes: number;
    notes?: string | null;
    status: ShiftStatus;
    created_by_ai: boolean;
    published_at?: string | null;
    assignments: ShiftAssignment[];
};

export type LaborCost = {
    location_id: number;
    week_start: string;
    total_shifts: number;
    total_hours: number;
    total_cost: number;
    hourly_rate: number;
};

/** GET /shifts/roles-with-staff */
export type RoleWithStaff = {
    role_id: number | null;
    role_name: string;
    employees: { user_id: number; name: string; role: string | null }[];
};

export type ShiftInput = {
    location_id: number;
    start_time: string;
    end_time: string;
    role_id?: number | null;
    break_minutes?: number;
    notes?: string | null;
};
