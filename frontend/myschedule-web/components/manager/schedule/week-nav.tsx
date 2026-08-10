"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type WeekNavProps = {
    weekStart: Date;
    onPrevWeek: () => void;
    onNextWeek: () => void;
    onToday: () => void;
};

function formatWeekRange(start: Date): string {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const startStr = start.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
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