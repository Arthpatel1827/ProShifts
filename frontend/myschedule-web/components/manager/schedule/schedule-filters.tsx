"use client";

import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { addDaysToKey, dateKeyIn, formatKey, timeIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClockStatus, ScheduleFlag, WeekStatusItem } from "@/lib/api/shifts";
import type { RoleWithStaff, Shift } from "@/lib/types";

export type ScheduleFilters = {
    userId: string; // "" = all
    role: string; // role name
    day: string; // "YYYY-MM-DD"
    status: string; // draft | published | cancelled
    assignment: string; // assigned | open
    time: string; // morning | afternoon | evening | overnight
    clock: string; // ClockStatus | late_arrival
    flag: string; // ScheduleFlag
};

export const EMPTY_FILTERS: ScheduleFilters = { userId: "", role: "", day: "", status: "", assignment: "", time: "", clock: "", flag: "" };

export const TIME_BUCKETS = {
    morning: "Morning (starts 5 a.m.–noon)",
    afternoon: "Afternoon (starts noon–5 p.m.)",
    evening: "Evening (starts 5–10 p.m.)",
    overnight: "Overnight (runs past midnight)",
} as const;

export const CLOCK_LABELS: Record<ClockStatus | "late_arrival", string> = {
    not_started: "Not started",
    working: "Working",
    on_break: "On break",
    ended: "Ended",
    late: "Late (not clocked in)",
    late_arrival: "Clocked in late",
    missed: "Missed",
};

export const FLAG_LABELS: Record<ScheduleFlag, string> = {
    availability: "Outside availability",
    overtime: "Overtime risk",
    conflict: "Conflict (overlap / time off)",
};

export function activeCount(f: ScheduleFilters) {
    return Object.values(f).filter(Boolean).length;
}

/** Filters that need clock-in / conflict data from the server. */
export function needsStatus(f: ScheduleFilters) {
    return !!(f.clock || f.flag);
}

function timeBucket(shift: Shift, tz: string): keyof typeof TIME_BUCKETS {
    if (dateKeyIn(shift.end_time, tz) !== dateKeyIn(shift.start_time, tz) && timeIn(shift.end_time, tz) !== "00:00") return "overnight";
    const h = Number(timeIn(shift.start_time, tz).slice(0, 2));
    if (h >= 22 || h < 5) return "overnight";
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
}

/** Shifts matching every active filter. Per-person filters (employee, clock status, flags)
 *  match a shift when at least one person on it matches all of them together. */
export function applyFilters(
    shifts: Shift[],
    f: ScheduleFilters,
    tz: string,
    roleOf: Map<number, string>,
    status: Map<string, WeekStatusItem> | null
): Shift[] {
    return shifts.filter((s) => {
        if (f.day && dateKeyIn(s.start_time, tz) !== f.day) return false;
        if (f.status && s.status !== f.status) return false;
        if (f.assignment === "open" && s.assignments.length > 0) return false;
        if (f.assignment === "assigned" && s.assignments.length === 0) return false;
        if (f.time && timeBucket(s, tz) !== f.time) return false;
        // Role: the shift's role, or (for "any role" shifts) the role of someone on it.
        if (f.role && s.role !== f.role && !(!s.role && s.assignments.some((a) => roleOf.get(a.user_id) === f.role))) return false;

        const perPerson = f.userId || f.clock || f.flag;
        if (!perPerson) return true;
        return s.assignments.some((a) => {
            if (f.userId && String(a.user_id) !== f.userId) return false;
            const st = status?.get(`${s.shift_id}|${a.user_id}`);
            if (f.clock) {
                if (!st) return false;
                if (f.clock === "late_arrival" ? !st.late_arrival : st.clock_status !== f.clock) return false;
            }
            if (f.flag && !st?.flags.includes(f.flag as ScheduleFlag)) return false;
            return true;
        });
    });
}

type Props = {
    value: ScheduleFilters;
    onChange: (next: ScheduleFilters) => void;
    weekStart: string;
    roles: RoleWithStaff[];
    locations: { id: number; name: string }[];
    locationId: number | null;
    onLocation: (id: number) => void;
    statusLoading?: boolean;
    shown: number;
    total: number;
};

export function ScheduleFilterPanel({ value: f, onChange, weekStart, roles, locations, locationId, onLocation, statusLoading, shown, total }: Props) {
    const set = (k: keyof ScheduleFilters, v: string) => onChange({ ...f, [k]: v });
    const seen = new Set<number>();
    const staff = roles
        .flatMap((r) => r.employees)
        .filter((e) => (seen.has(e.user_id) ? false : (seen.add(e.user_id), true)))
        .sort((a, b) => a.name.localeCompare(b.name));
    const roleNames = roles.filter((r) => r.role_id !== null).map((r) => r.role_name);
    const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
    const n = activeCount(f);

    const field = (id: keyof ScheduleFilters | "location", label: string, control: React.ReactNode) => (
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground" htmlFor={`filter-${id}`}>
            {label}
            {control}
        </label>
    );

    return (
        <section aria-label="Schedule filters" className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Filter className="size-4" /> Schedule filters
                    {n > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{n}</span>}
                </h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span aria-live="polite">{n ? `Showing ${shown} of ${total} shifts` : `${total} shifts`}{statusLoading ? " · checking clock-ins…" : ""}</span>
                    <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)} disabled={!n}>
                        <X /> Clear
                    </Button>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
                {field("userId", "Employee",
                    <Select id="filter-userId" value={f.userId} onChange={(e) => set("userId", e.target.value)}>
                        <option value="">All</option>
                        {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                    </Select>)}
                {field("role", "Role",
                    <Select id="filter-role" value={f.role} onChange={(e) => set("role", e.target.value)}>
                        <option value="">All</option>
                        {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>)}
                {field("location", "Location",
                    <Select id="filter-location" value={locationId ?? ""} onChange={(e) => onLocation(Number(e.target.value))} disabled={locations.length < 2}>
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>)}
                {field("day", "Day",
                    <Select id="filter-day" value={f.day} onChange={(e) => set("day", e.target.value)}>
                        <option value="">All week</option>
                        {days.map((d) => <option key={d} value={d}>{formatKey(d, { weekday: "long", month: "short", day: "numeric" })}</option>)}
                    </Select>)}
                {field("status", "Shift status",
                    <Select id="filter-status" value={f.status} onChange={(e) => set("status", e.target.value)}>
                        <option value="">All</option>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                        <option value="cancelled">Cancelled</option>
                    </Select>)}
                {field("assignment", "Assignment",
                    <Select id="filter-assignment" value={f.assignment} onChange={(e) => set("assignment", e.target.value)}>
                        <option value="">All</option>
                        <option value="assigned">Assigned</option>
                        <option value="open">Open (unassigned)</option>
                    </Select>)}
                {field("time", "Time",
                    <Select id="filter-time" value={f.time} onChange={(e) => set("time", e.target.value)}>
                        <option value="">All</option>
                        {Object.entries(TIME_BUCKETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>)}
                {field("clock", "Clock status",
                    <Select id="filter-clock" value={f.clock} onChange={(e) => set("clock", e.target.value)}>
                        <option value="">All</option>
                        {Object.entries(CLOCK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>)}
                {field("flag", "Warnings",
                    <Select id="filter-flag" value={f.flag} onChange={(e) => set("flag", e.target.value)} className={cn(f.flag && "border-warning")}>
                        <option value="">All</option>
                        {Object.entries(FLAG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>)}
            </div>
        </section>
    );
}
