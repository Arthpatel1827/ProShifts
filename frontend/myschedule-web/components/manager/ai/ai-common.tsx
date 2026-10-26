// Shared bits for the AI features: labels, the "AI" mark, and wall-clock time formatting.
import { Sparkles } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "17:00" (location wall clock from the API) → "5:00 p.m." in the app's usual style. */
export function wallTime(hhmm: string): string {
    const [h, m] = hhmm.split(":").map(Number);
    return formatTime(new Date(Date.UTC(2000, 0, 1, h, m)), "UTC");
}

export function AIMark({ className }: { className?: string }) {
    return <Sparkles aria-hidden className={cn("size-4 text-primary", className)} />;
}

/** What each backend tool looked at, in words a manager recognises. */
export const TOOL_LABELS: Record<string, string> = {
    list_staff: "Staff list",
    get_week_schedule: "Week schedule",
    get_employee_availability: "Availability",
    find_available_staff: "Availability, time off & conflicts",
    find_shift_replacements: "Replacement check",
    get_employee_hours: "Scheduled hours",
    get_overtime_risk: "Overtime risk",
    get_open_shifts: "Open shifts",
    get_labor_cost: "Labor cost",
    get_time_off: "Time-off requests",
    get_schedule_conflicts: "Schedule conflicts",
};

export function Kind({ kind }: { kind: "fact" | "recommendation" }) {
    return (
        <span
            className={cn(
                "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                kind === "fact" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
            )}
        >
            {kind === "fact" ? "Fact" : "AI suggestion"}
        </span>
    );
}
