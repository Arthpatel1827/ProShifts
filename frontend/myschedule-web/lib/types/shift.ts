export type ShiftStatus = "draft" | "published" | "cancelled";

export type ShiftAssignment = {
    user_id: number;
    assigned_at: string;
};

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
    total_shifts: number;
    total_hours: number;
    total_cost: number;
    hourly_rate: number;
};