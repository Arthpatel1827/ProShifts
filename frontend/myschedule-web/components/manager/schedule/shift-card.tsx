"use client";

import { Sparkles, Users, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeRange } from "@/lib/format";
import type { Shift } from "@/lib/types";

type ShiftCardProps = {
    shift: Shift;
    /** user_id → display name, from /shifts/roles-with-staff */
    names?: Map<number, string>;
    onClick?: () => void;
};

const STATUS_STYLES: Record<Shift["status"], { bg: string; text: string; label: string; bar: string }> = {
    draft: { bg: "bg-warning/15", text: "text-warning-foreground dark:text-warning", label: "DRAFT", bar: "bg-warning" },
    published: { bg: "bg-success/15", text: "text-success", label: "LIVE", bar: "bg-success" },
    cancelled: { bg: "bg-muted", text: "text-muted-foreground", label: "CANCELLED", bar: "bg-muted-foreground/40" },
};

export function ShiftCard({ shift, names, onClick }: ShiftCardProps) {
    const style = STATUS_STYLES[shift.status];
    const isCancelled = shift.status === "cancelled";
    const assignees = shift.assignments.map((a) => names?.get(a.user_id) ?? `#${a.user_id}`);
    const unassigned = assignees.length === 0 && !isCancelled;

    return (
        <button
            onClick={onClick}
            className={cn(
                "relative w-full overflow-hidden rounded-md border border-border bg-card p-2 pl-3 text-left text-xs shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCancelled && "opacity-50"
            )}
        >
            <span className={cn("absolute inset-y-0 left-0 w-1", style.bar)} aria-hidden />
            <div className="mb-1 flex flex-wrap items-start justify-between gap-1">
                <span className={cn("min-w-0 font-medium leading-snug text-foreground", isCancelled && "line-through")}>
                    {formatTimeRange(shift.start_time, shift.end_time)}
                </span>
                <span
                    className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        style.bg,
                        style.text
                    )}
                >
                    {shift.created_by_ai && <Sparkles className="h-2.5 w-2.5" aria-label="AI generated" />}
                    {style.label}
                </span>
            </div>

            {shift.role && <p className="mb-1 truncate text-muted-foreground">{shift.role}</p>}

            {unassigned ? (
                <div className="flex items-center gap-1 font-medium text-destructive">
                    <UserX className="h-3 w-3" />
                    Unassigned
                </div>
            ) : (
                <div className="flex items-center gap-1 text-muted-foreground">
                    <Users className="h-3 w-3 shrink-0" />
                    <span className="truncate">{assignees.join(", ")}</span>
                </div>
            )}
        </button>
    );
}
