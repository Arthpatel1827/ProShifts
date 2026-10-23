"use client";

import { Plus } from "lucide-react";
import { ShiftCard } from "./shift-card";
import { addDays, formatHours, isSameDay, shiftHours, toDateKey } from "@/lib/format";
import type { Shift } from "@/lib/types";

type WeekGridProps = {
    weekStart: Date;
    shifts: Shift[];
    names?: Map<number, string>;
    onAddShift: (date: Date) => void;
    onShiftClick: (shift: Shift) => void;
};

export function WeekGrid({ weekStart, shifts, names, onAddShift, onShiftClick }: WeekGridProps) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const today = new Date();

    const shiftsByDay = new Map<string, Shift[]>();
    days.forEach((d) => shiftsByDay.set(toDateKey(d), []));
    shifts.forEach((shift) => {
        const key = toDateKey(new Date(shift.start_time));
        shiftsByDay.get(key)?.push(shift);
    });

    return (
        // Horizontal scroll on narrow screens rather than squashing seven columns.
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="grid min-w-[840px] grid-cols-7 gap-3">
                {days.map((day) => {
                    const key = toDateKey(day);
                    const dayShifts = shiftsByDay.get(key) ?? [];
                    const isToday = isSameDay(day, today);
                    const hours = dayShifts
                        .filter((s) => s.status !== "cancelled")
                        .reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time, s.break_minutes), 0);

                    return (
                        <div
                            key={key}
                            className={`flex min-h-[400px] flex-col rounded-lg border ${isToday ? "border-primary" : "border-border"} bg-card`}
                        >
                            <div
                                className={`flex items-center justify-between border-b border-border px-3 py-2 ${isToday ? "bg-primary/5" : ""}`}
                            >
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                        {day.toLocaleDateString("en-CA", { weekday: "short" })}
                                    </p>
                                    <p className={`text-sm font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
                                        {day.getDate()}
                                        {hours > 0 && (
                                            <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">
                                                {formatHours(hours)}
                                            </span>
                                        )}
                                    </p>
                                </div>

                                <button
                                    onClick={() => onAddShift(day)}
                                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                    aria-label={`Add shift on ${day.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}`}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            <div className="flex-1 space-y-2 p-2">
                                {dayShifts.length === 0 ? (
                                    <button
                                        onClick={() => onAddShift(day)}
                                        className="w-full rounded-md pt-4 text-center text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        No shifts
                                    </button>
                                ) : (
                                    dayShifts.map((shift) => (
                                        <ShiftCard
                                            key={shift.shift_id}
                                            shift={shift}
                                            names={names}
                                            onClick={() => onShiftClick(shift)}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
