"use client";

import { useState, useEffect, useCallback } from "react";
import { WeekNav } from "@/components/manager/schedule/week-nav";
import { WeekGrid } from "@/components/manager/schedule/week-grid";
import { listShifts } from "@/lib/api/shifts";
import { listLocations } from "@/lib/api/locations";
import type { Shift, Location } from "@/lib/types";

function getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0, 0, 0, 0);
    return d;
}

function toDateKey(d: Date): string {
    return d.toISOString().split("T")[0];
}

export default function SchedulePage() {
    const [locations, setLocations] = useState<Location[]>([]);
    const [locationId, setLocationId] = useState<number | null>(null);
    const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load locations once on mount
    useEffect(() => {
        listLocations()
            .then((locs) => {
                setLocations(locs);
                if (locs.length > 0) setLocationId(locs[0].id);
            })
            .catch((err) => setError(err.message));
    }, []);

    const fetchShifts = useCallback(async () => {
        if (!locationId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await listShifts(locationId, toDateKey(weekStart));
            setShifts(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load shifts");
        } finally {
            setLoading(false);
        }
    }, [locationId, weekStart]);

    useEffect(() => {
        fetchShifts();
    }, [fetchShifts]);

    function handlePrevWeek() {
        setWeekStart((prev) => {
            const d = new Date(prev);
            d.setDate(d.getDate() - 7);
            return d;
        });
    }

    function handleNextWeek() {
        setWeekStart((prev) => {
            const d = new Date(prev);
            d.setDate(d.getDate() + 7);
            return d;
        });
    }

    function handleToday() {
        setWeekStart(getMonday(new Date()));
    }

    function handleAddShift(date: Date) {
        // TODO: open a create-shift modal — not built yet
        console.log("Add shift for", toDateKey(date));
    }

    function handleShiftClick(shift: Shift) {
        // TODO: open a shift-detail modal — not built yet
        console.log("Clicked shift", shift.shift_id);
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <WeekNav
                    weekStart={weekStart}
                    onPrevWeek={handlePrevWeek}
                    onNextWeek={handleNextWeek}
                    onToday={handleToday}
                />

                {locations.length > 1 && (
                    <select
                        value={locationId ?? ""}
                        onChange={(e) => setLocationId(Number(e.target.value))}
                        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    >
                        {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                                {loc.name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {error && (
                <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error}
                </p>
            )}

            {loading ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Loading shifts…</p>
            ) : (
                <WeekGrid
                    weekStart={weekStart}
                    shifts={shifts}
                    onAddShift={handleAddShift}
                    onShiftClick={handleShiftClick}
                />
            )}
        </div>
    );
}