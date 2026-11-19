export type PersonRef = { user_id: number | null; name: string | null };

export type RequestShift = {
    shift_id?: number;
    start_time: string | null;
    end_time: string | null;
    break_minutes: number;
    role: string | null;
    location?: string | null;
};

export type ShiftConflict = {
    shift_id: number;
    start_time: string;
    end_time: string;
    role: string | null;
};

export type PlacementIssue = { code: string; message: string; shift_id?: number };

/** One person's side of a swap, checked against their schedule AFTER the swap. */
export type SwapSide = {
    user_id: number;
    name: string | null;
    ok: boolean;
    errors: PlacementIssue[];
    availability: string | null;
    warnings: PlacementIssue[];
    week_hours_after: number | null;
    gives: RequestShift | null;
    receives: RequestShift | null;
};

/** Resulting-schedule validation, recalculated by the server whenever it's asked. */
export type SwapValidation = {
    ok: boolean;
    /** Only availability is in the way; a manager may approve anyway. */
    needs_override: boolean;
    errors: string[];
    availability: string[];
    warnings: string[];
    requester: SwapSide | null;
    receiver: SwapSide | null;
};

/** GET /swaps/pending-manager (serialized with include_conflicts) */
export type SwapRequest = {
    swap_id: number;
    swap_type: string;
    status: string;
    reason: string | null;
    manager_approved: boolean | null;
    ai_suggested: boolean;
    created_at: string;
    requester: PersonRef;
    receiver: PersonRef | null;
    shift: RequestShift | null;
    offered_shift: RequestShift | null;
    conflicts?: { requester: ShiftConflict[]; receiver: ShiftConflict[] };
    validation?: SwapValidation;
};

/** GET /drops/pending */
export type DropRequest = {
    drop_id: number;
    shift_id: number;
    user_id: number;
    employee?: PersonRef;
    reason: string | null;
    status: string;
    created_at: string;
    shift: RequestShift | null;
};

/** GET /time-off/pending */
export type TimeOffRequest = {
    request_id: number;
    user_id: number;
    employee?: PersonRef;
    start_date: string;
    end_date: string;
    days: number;
    request_type: string;
    reason: string | null;
    status: string;
    manager_notes: string | null;
    created_at: string;
};
