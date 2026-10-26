import { api, qs } from "./client";

export type WorkedBreak = {
    break_id: number;
    break_start: string;
    break_end: string | null;
    duration_minutes: number | null;
    is_active: boolean;
};

/** What was actually worked (not the scheduled shift). */
export type WorkedEntry = {
    entry_id: number;
    user_id: number;
    employee_name: string | null;
    shift_id: number | null;
    shift?: { shift_id: number; start_time: string; end_time: string; role: string | null };
    clock_in: string;
    clock_out: string | null;
    total_minutes: number | null;
    is_active: boolean;
    breaks: WorkedBreak[];
    corrected_at: string | null;
    corrected_by: number | null;
};

export type AuditRow = {
    audit_id: number;
    action: "clock_in" | "clock_out" | "break_added" | "break_changed" | "break_removed";
    old_value: string | null;
    new_value: string | null;
    reason: string;
    changed_by_name: string | null;
    changed_at: string;
};

export async function listWorked(locationId: number, weekStart: string): Promise<WorkedEntry[]> {
    const res = await api.get<{ entries: WorkedEntry[] }>(`/time-entries/manage${qs({ location_id: locationId, week_start: weekStart })}`);
    return res.entries;
}

/** Times are naive wall-clock at the location ("2026-10-26T09:00:00"). A reason is required. */
export async function correctEntry(entryId: number, body: { clock_in?: string; clock_out?: string; reason: string }) {
    return (await api.patch<{ entry: WorkedEntry }>(`/time-entries/${entryId}`, body)).entry;
}

export async function addWorkedBreak(entryId: number, body: { break_start: string; break_end: string; reason: string }) {
    return (await api.post<{ entry: WorkedEntry }>(`/time-entries/${entryId}/breaks`, body)).entry;
}

export async function updateWorkedBreak(breakId: number, body: { break_start?: string; break_end?: string; reason: string }) {
    return (await api.patch<{ entry: WorkedEntry }>(`/time-entries/breaks/${breakId}`, body)).entry;
}

export async function deleteWorkedBreak(breakId: number, reason: string) {
    return (await api.delete<{ entry: WorkedEntry }>(`/time-entries/breaks/${breakId}`, { reason })).entry;
}

export async function entryHistory(entryId: number): Promise<AuditRow[]> {
    return (await api.get<{ history: AuditRow[] }>(`/time-entries/${entryId}/audit`)).history;
}
