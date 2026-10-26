"use client";

import { useEffect, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { ShiftCard } from "./shift-card";
import { DRAG_MIME, dragState } from "./drag-state";
import { cn } from "@/lib/utils";
import { addDaysToKey, dateKeyIn, formatHours, formatKey, shiftHours, todayKey } from "@/lib/format";
import type { Shift } from "@/lib/types";

type WeekGridProps = {
    /** Monday, "YYYY-MM-DD" at the location. */
    weekStart: string;
    /** Location timezone: shifts sit in the column of their *local* start date. */
    tz: string;
    shifts: Shift[];
    names?: Map<number, string>;
    onAddShift: (dateKey: string) => void;
    onShiftClick: (shift: Shift) => void;
    /** Copy all of a day's shifts to other days. */
    onCopyDay?: (dateKey: string, shifts: Shift[]) => void;
    /** Drag & drop a shift onto another day (same times, same people). */
    onDropShift?: (shift: Shift, dateKey: string) => void;
    busyId?: number | null;
};

export function WeekGrid({ weekStart, tz, shifts, names, onAddShift, onShiftClick, onCopyDay, onDropShift, busyId }: WeekGridProps) {
    const [over, setOver] = useState<string | null>(null);
    // Drag cancelled (Esc, dropped outside): clear the highlight.
    useEffect(() => dragState.subscribe(() => !dragState.get() && setOver(null)), []);
    const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
    const today = todayKey(tz);

    // An overnight shift stays one card, in the column of the day it starts.
    const shiftsByDay = new Map<string, Shift[]>();
    days.forEach((d) => shiftsByDay.set(d, []));
    shifts.forEach((shift) => {
        shiftsByDay.get(dateKeyIn(shift.start_time, tz))?.push(shift);
    });

    return (
        // Horizontal scroll on narrow screens rather than squashing seven columns.
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="grid min-w-[840px] grid-cols-7 gap-3">
                {days.map((day) => {
                    const key = day;
                    const dayShifts = shiftsByDay.get(key) ?? [];
                    const isToday = day === today;
                    const hours = dayShifts
                        .filter((s) => s.status !== "cancelled")
                        .reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time, s.break_minutes), 0);

                    const dragging = dragState.get();
                    const sameDay = !!dragging && dateKeyIn(dragging.shift.start_time, tz) === key;
                    return (
                        <div
                            key={key}
                            data-day={key}
                            onDragOver={(e) => {
                                if (!onDropShift || !e.dataTransfer.types.includes(DRAG_MIME)) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = sameDay ? "none" : "move";
                                if (over !== key) setOver(key);
                            }}
                            onDragLeave={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                setOver(null);
                                const item = dragState.get();
                                dragState.set(null);
                                if (item && onDropShift && dateKeyIn(item.shift.start_time, tz) !== key) onDropShift(item.shift, key);
                            }}
                            className={cn(
                                "flex min-h-[400px] flex-col rounded-lg border bg-card transition-colors",
                                isToday ? "border-primary" : "border-border",
                                over === key && !sameDay && "border-primary bg-primary/5 ring-2 ring-primary/30",
                                over === key && sameDay && "border-dashed border-muted-foreground/40"
                            )}
                        >
                            <div
                                className={`flex items-center justify-between border-b border-border px-3 py-2 ${isToday ? "bg-primary/5" : ""}`}
                            >
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                                        {formatKey(day, { weekday: "short", month: undefined, day: undefined })}
                                    </p>
                                    <p className={`text-sm font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
                                        {Number(day.slice(8, 10))}
                                        {hours > 0 && (
                                            <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">
                                                {formatHours(hours)}
                                            </span>
                                        )}
                                    </p>
                                </div>

                                <div className="flex items-center">
                                    {onCopyDay && dayShifts.some((s) => s.status !== "cancelled") && (
                                        <button
                                            onClick={() => onCopyDay(day, dayShifts.filter((s) => s.status !== "cancelled"))}
                                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                            aria-label={`Copy ${formatKey(day, { weekday: "long", month: "long", day: "numeric" })} to other days`}
                                            title="Copy this day"
                                        >
                                            <Copy className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => onAddShift(day)}
                                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                        aria-label={`Add shift on ${formatKey(day, { weekday: "long", month: "long", day: "numeric" })}`}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                    </button>
                                </div>
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
                                            tz={tz}
                                            names={names}
                                            onClick={() => onShiftClick(shift)}
                                            draggable={!!onDropShift}
                                            busy={busyId === shift.shift_id}
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
