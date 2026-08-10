"use client";

import { Sparkles, Users } from "lucide-react";
import type { Shift } from "@/lib/types";

type ShiftCardProps = {
    shift: Shift;
    onClick?: () => void;
};

const STATUS_STYLES: Record<Shift["status"], { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-warning/10", text: "text-warning", label: "DRAFT" },
    published: { bg: "bg-success/10", text: "text-success", label: "LIVE" },
    cancelled: { bg: "bg-muted", text: "text-muted-foreground", label: "CANCELLED" },
};

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-CA", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
}

export function ShiftCard({ shift, onClick }: ShiftCardProps) {
    const style = STATUS_STYLES[shift.status];
    const isCancelled = shift.status === "cancelled";

    return (
        <button
            onClick={onClick}
            className={`w-full rounded-md border border-border bg-card p-2 text-left text-xs shadow-sm transition-opacity hover:opacity-90 ${isCancelled ? "opacity-50" : ""
                }`}
        >
            <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-foreground">
                    {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                </span>
                <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text}`}>
                    {shift.created_by_ai && <Sparkles className="h-2.5 w-2.5" />}
                    {style.label}
                </span>
            </div>

            {shift.role && <p className="mb-1 text-muted-foreground">{shift.role}</p>}

            <div className="flex items-center gap-1 text-muted-foreground">
                <Users className="h-3 w-3" />
                {shift.assignments.length} assigned
            </div>
        </button>
    );
}