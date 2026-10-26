"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysToKey, formatKey } from "@/lib/format";

type WeekNavProps = {
    /** Monday of the week, "YYYY-MM-DD" at the location. */
    weekStart: string;
    onPrevWeek: () => void;
    onNextWeek: () => void;
    onToday: () => void;
};

function formatWeekRange(start: string): string {
    const startStr = formatKey(start, { weekday: undefined, month: "short", day: "numeric" });
    const endStr = formatKey(addDaysToKey(start, 6), { weekday: undefined, month: "short", day: "numeric", year: "numeric" });
    return `${startStr} – ${endStr}`;
}

export function WeekNav({ weekStart, onPrevWeek, onNextWeek, onToday }: WeekNavProps) {
    return (
        <div className="flex items-center gap-3">
            <button
                onClick={onPrevWeek}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="Previous week"
            >
                <ChevronLeft className="h-4 w-4" />
            </button>

            <span className="min-w-[180px] text-center text-sm font-medium text-foreground">
                {formatWeekRange(weekStart)}
            </span>

            <button
                onClick={onNextWeek}
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="Next week"
            >
                <ChevronRight className="h-4 w-4" />
            </button>

            <button
                onClick={onToday}
                className="ml-2 rounded-md border border-input px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
                Today
            </button>
        </div>
    );
}