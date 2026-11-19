export type ShiftStatus = "draft" | "published" | "cancelled";

export type ShiftAssignment = {
    user_id: number;
    assigned_at: string;
};

/** A planned break inside a scheduled shift (not the break someone actually took). */
export type ShiftBreak = {
    break_id: number;
    start_time: string;
    end_time: string;
    minutes: number;
};

/** Shape returned by ShiftService.serialize. Times are naive ISO strings (no offset). */
export type Shift = {
    shift_id: number;
    location_id: number;
    role?: string | null;
    role_id?: number | null;
    location_name?: string | null;
    timezone?: string;
    breaks?: ShiftBreak[];
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
    /** Planned breaks as naive local ISO times; [] removes them. */
    breaks?: { start_time: string; end_time: string }[];
    /** Manager confirmed keeping staff on despite their availability. */
    allow_outside_availability?: boolean;
};

/** One person's result from the shared scheduling rules (utils/schedule_rules.py). */
export type Placement = {
    user_id: number;
    name: string | null;
    ok: boolean;
    errors: { code: string; message: string; shift_id?: number }[];
    availability: string | null;
    warnings: { code: string; message: string }[];
    week_hours_after: number | null;
};

/** Where a drag & drop puts the shift. Times are wall-clock at the location. */
export type MoveTarget = {
    date?: string;
    start?: string;
    from_user_id?: number | null;
    to_user_id?: number | null;
};

export type MoveResult = {
    shift: Shift;
    applied: boolean;
    warnings: string[];
    placements: Placement[];
    /** Values that put the shift back where it was. */
    undo: MoveTarget;
};
