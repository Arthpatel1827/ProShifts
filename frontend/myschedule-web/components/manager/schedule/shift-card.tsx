"use client";

import { Coffee, Loader2, Sparkles, Users, UserX } from "lucide-react";
import { DRAG_MIME, dragState } from "./drag-state";
import { cn } from "@/lib/utils";
import { formatTimeRange } from "@/lib/format";
import type { Shift } from "@/lib/types";

type ShiftCardProps = {
    shift: Shift;
    /** Location timezone for the displayed times. */
    tz: string;
    /** user_id → display name, from /shifts/roles-with-staff */
    names?: Map<number, string>;
    onClick?: () => void;
    /** Allow dragging this card to another day/person/time. */
    draggable?: boolean;
    /** In a per-person row: whose copy of the shift this card is. */
    dragUserId?: number | null;
    /** A move of this shift is being saved. */
    busy?: boolean;
    /** Show one person's name instead of everyone on the shift. */
    onlyName?: string;
};

const STATUS_STYLES: Record<Shift["status"], { bg: string; text: string; label: string; bar: string }> = {
    draft: { bg: "bg-warning/15", text: "text-warning-foreground dark:text-warning", label: "DRAFT", bar: "bg-warning" },
    published: { bg: "bg-success/15", text: "text-success", label: "LIVE", bar: "bg-success" },
    cancelled: { bg: "bg-muted", text: "text-muted-foreground", label: "CANCELLED", bar: "bg-muted-foreground/40" },
};

export function ShiftCard({ shift, tz, names, onClick, draggable, dragUserId = null, busy, onlyName }: ShiftCardProps) {
    const style = STATUS_STYLES[shift.status];
    const isCancelled = shift.status === "cancelled";
    const assignees = onlyName ? [onlyName] : shift.assignments.map((a) => names?.get(a.user_id) ?? `#${a.user_id}`);
    const unassigned = shift.assignments.length === 0 && !isCancelled;
    const canDrag = !!draggable && !isCancelled && !busy;
    const plannedBreaks = shift.breaks?.length ?? 0;

    return (
        <button
            onClick={onClick}
            draggable={canDrag}
            onDragStart={(e) => {
                if (!canDrag) return;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(DRAG_MIME, String(shift.shift_id));
                e.dataTransfer.setData("text/plain", formatTimeRange(shift.start_time, shift.end_time, tz));
                dragState.set({ shift, fromUserId: dragUserId });
            }}
            onDragEnd={() => dragState.set(null)}
            aria-busy={busy || undefined}
            data-shift-id={shift.shift_id}
            title={canDrag ? "Drag to move · click for details" : undefined}
            className={cn(
                "relative w-full overflow-hidden rounded-md border border-border bg-card p-2 pl-3 text-left text-xs shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                canDrag && "cursor-grab active:cursor-grabbing",
                isCancelled && "opacity-50",
                busy && "opacity-60"
            )}
        >
            {busy && <Loader2 className="absolute right-1.5 bottom-1.5 size-3 animate-spin text-primary" aria-label="Saving" />}
            <span className={cn("absolute inset-y-0 left-0 w-1", style.bar)} aria-hidden />
            <div className="mb-1 flex flex-wrap items-start justify-between gap-1">
                <span className={cn("min-w-0 font-medium leading-snug text-foreground", isCancelled && "line-through")}>
                    {formatTimeRange(shift.start_time, shift.end_time, tz)}
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
            {plannedBreaks > 0 && (
                <p className="mb-1 flex items-center gap-1 text-muted-foreground">
                    <Coffee className="h-3 w-3" /> {plannedBreaks} break{plannedBreaks === 1 ? "" : "s"} · {shift.break_minutes} min
                </p>
            )}

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
