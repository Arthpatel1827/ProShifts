"use client";

import { Plus } from "lucide-react";
import { ShiftCard } from "./shift-card";
import type { Shift } from "@/lib/types";

type WeekGridProps = {
    weekStart: Date;
    shifts: Shift[];
    onAddShift: (date: Date) => void;
    onShiftClick: (shift: Shift) => void;
};

function getWeekDays(weekStart: Date): Date[] {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        return d;
    });
}

function toDateKey(d: Date): string {
    return d.toISOString().split("T")[0];
}

function isToday(d: Date): boolean {
    const today = new Date();
    return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
    );
}

export function WeekGrid({ weekStart, shifts, onAddShift, onShiftClick }: WeekGridProps) {
    const days = getWeekDays(weekStart);

    const shiftsByDay = new Map<string, Shift[]>();
    days.forEach((d) => shiftsByDay.set(toDateKey(d), []));
    shifts.forEach((shift) => {
        const key = toDateKey(new Date(shift.start_time));
        if (shiftsByDay.has(key)) {
            shiftsByDay.get(key)!.push(shift);
        }
    });

    return (
        <div className="grid grid-cols-7 gap-3">
            {days.map((day) => {
                const key = toDateKey(day);
                const dayShifts = shiftsByDay.get(key) ?? [];
                const today = isToday(day);

                return (
                    <div
                        key={key}
                        className={`flex min-h-[400px] flex-col rounded-lg border ${today ? "border-primary" : "border-border"
                            } bg-card`}
                    >
                        <div
                            className={`flex items-center justify-between border-b border-border px-3 py-2 ${today ? "bg-primary/5" : ""
                                }`}
                        >
                            <div>
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                    {day.toLocaleDateString("en-CA", { weekday: "short" })}
                                </p>
                                <p className={`text-sm font-semibold ${today ? "text-primary" : "text-foreground"}`}>
                                    {day.getDate()}
                                </p>
                            </div>

                            <button
                                onClick={() => onAddShift(day)}
                                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                aria-label="Add shift"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="flex-1 space-y-2 p-2">
                            {dayShifts.length === 0 ? (
                                <p className="pt-4 text-center text-xs text-muted-foreground">No shifts</p>
                            ) : (
                                dayShifts.map((shift) => (
                                    <ShiftCard key={shift.shift_id} shift={shift} onClick={() => onShiftClick(shift)} />
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}