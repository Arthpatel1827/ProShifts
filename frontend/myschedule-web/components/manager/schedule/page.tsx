"use client";

import { useMemo, useState } from "react";
import { Plus, Send, Sparkles } from "lucide-react";
import { WeekNav } from "@/components/manager/schedule/week-nav";
import { WeekGrid } from "@/components/manager/schedule/week-grid";
import { ShiftFormDialog } from "@/components/manager/schedule/shift-form-dialog";
import { ShiftDetailDialog } from "@/components/manager/schedule/shift-detail-dialog";
import { ScheduleCopilotDialog } from "@/components/manager/ai/schedule-copilot-dialog";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { getLaborCost, listShifts, publishWeek, rolesWithStaff } from "@/lib/api/shifts";
import { useQuery } from "@/lib/hooks/use-query";
import { useLiveRefresh } from "@/lib/hooks/use-socket";
import { addDaysToKey, formatHours, formatMoney, mondayOfKey, todayKey } from "@/lib/format";
import type { Shift } from "@/lib/types";

export default function SchedulePage() {
    const { location, timezone: tz } = useManager();
    const toast = useToast();
    const locationId = location?.id ?? null;
    // Weeks are Monday–Sunday at the *location*, whatever the viewer's computer says.
    const [weekPick, setWeekPick] = useState<string | null>(null);
    const weekKey = weekPick ?? mondayOfKey(todayKey(tz));

    const shifts = useQuery(locationId ? ["shifts", locationId, weekKey] : null, () =>
        listShifts(locationId!, weekKey)
    );
    const labor = useQuery(locationId ? ["labor", locationId, weekKey] : null, () =>
        getLaborCost(locationId!, weekKey)
    );
    const roles = useQuery(locationId ? ["roles", locationId] : null, () => rolesWithStaff(locationId!));

    // Another manager (or the AI generator) changing this location's schedule.
    useLiveRefresh(locationId, ["shift:updated", "schedule:published"], () => {
        void shifts.refetch();
        void labor.refetch();
    });

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Shift | null>(null);
    const [newDate, setNewDate] = useState<string | null>(null);
    const [selected, setSelected] = useState<Shift | null>(null);
    const [confirmPublish, setConfirmPublish] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [copilotOpen, setCopilotOpen] = useState(false);

    const names = useMemo(() => {
        const map = new Map<number, string>();
        roles.data?.forEach((r) => r.employees.forEach((e) => map.set(e.user_id, e.name)));
        return map;
    }, [roles.data]);

    const list = shifts.data ?? [];
    const draftCount = list.filter((s) => s.status === "draft").length;
    const openCount = list.filter((s) => s.status !== "cancelled" && s.assignments.length === 0).length;

    function upsert(shift: Shift) {
        shifts.setData((prev = []) => {
            const exists = prev.some((s) => s.shift_id === shift.shift_id);
            const next = exists ? prev.map((s) => (s.shift_id === shift.shift_id ? shift : s)) : [...prev, shift];
            return next.sort((a, b) => a.start_time.localeCompare(b.start_time));
        });
        setSelected((cur) => (cur?.shift_id === shift.shift_id ? shift : cur));
        void labor.refetch();
    }

    function openCreate(date: string) {
        setEditing(null);
        setNewDate(date);
        setFormOpen(true);
    }

    function openEdit(shift: Shift) {
        setSelected(null);
        setEditing(shift);
        setFormOpen(true);
    }

    async function handlePublish() {
        if (!locationId) return;
        setPublishing(true);
        try {
            const count = await publishWeek(locationId, weekKey);
            toast.success(`Published ${count} shift${count === 1 ? "" : "s"}`, "Your team has been notified.");
            setConfirmPublish(false);
            await shifts.refetch();
        } catch (err) {
            toast.error("Couldn't publish", err instanceof Error ? err.message : undefined);
        } finally {
            setPublishing(false);
        }
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <WeekNav
                    weekStart={weekKey}
                    onPrevWeek={() => setWeekPick(addDaysToKey(weekKey, -7))}
                    onNextWeek={() => setWeekPick(addDaysToKey(weekKey, 7))}
                    onToday={() => setWeekPick(null)}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="lg" onClick={() => setCopilotOpen(true)} className="border-primary/30 text-primary hover:bg-primary/5 hover:text-primary">
                        <Sparkles /> AI Schedule Copilot
                    </Button>
                    <Button variant="outline" size="lg" onClick={() => openCreate(todayKey(tz) > weekKey ? todayKey(tz) : weekKey)}>
                        <Plus /> Add shift
                    </Button>
                    <Button size="lg" onClick={() => setConfirmPublish(true)} disabled={draftCount === 0}>
                        <Send /> Publish{draftCount ? ` ${draftCount} draft${draftCount === 1 ? "" : "s"}` : ""}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card px-5 py-3 text-sm sm:flex sm:flex-wrap sm:gap-8">
                <Summary label="Shifts" value={labor.data?.total_shifts ?? "—"} />
                <Summary label="Scheduled hours" value={labor.data ? formatHours(labor.data.total_hours) : "—"} />
                <Summary label="Est. labor cost" value={labor.data ? formatMoney(labor.data.total_cost) : "—"} />
                <Summary
                    label="Unassigned"
                    value={shifts.data ? openCount : "—"}
                    tone={openCount > 0 ? "danger" : undefined}
                />
            </div>

            {shifts.error && <ErrorState message={shifts.error.message} onRetry={shifts.refetch} />}
            {roles.error && (
                <ErrorState message={`Couldn't load staff: ${roles.error.message}`} onRetry={roles.refetch} />
            )}

            {shifts.loading ? (
                <div className="grid grid-cols-7 gap-3">
                    {Array.from({ length: 7 }, (_, i) => (
                        <Skeleton key={i} className="h-[400px]" />
                    ))}
                </div>
            ) : (
                <WeekGrid
                    weekStart={weekKey}
                    tz={tz}
                    shifts={list}
                    names={names}
                    onAddShift={openCreate}
                    onShiftClick={setSelected}
                />
            )}

            {locationId && (
                <ShiftFormDialog
                    open={formOpen}
                    onOpenChange={setFormOpen}
                    locationId={locationId}
                    roles={roles.data ?? []}
                    shift={editing}
                    defaultDate={newDate}
                    tz={tz}
                    onSaved={upsert}
                />
            )}

            {locationId && (
                <ScheduleCopilotDialog
                    open={copilotOpen}
                    onOpenChange={setCopilotOpen}
                    locationId={locationId}
                    weekStart={weekKey}
                    roles={roles.data ?? []}
                    onApplied={() => {
                        void shifts.refetch();
                        void labor.refetch();
                    }}
                />
            )}

            <ShiftDetailDialog
                shift={selected}
                tz={tz}
                onOpenChange={(open) => !open && setSelected(null)}
                roles={roles.data ?? []}
                names={names}
                onEdit={openEdit}
                onChanged={upsert}
            />

            <ConfirmDialog
                open={confirmPublish}
                onOpenChange={setConfirmPublish}
                title="Publish this week?"
                description={`${draftCount} draft shift${draftCount === 1 ? "" : "s"} will go live and everyone at ${location?.name ?? "this location"} will be notified.${openCount ? ` ${openCount} shift${openCount === 1 ? " is" : "s are"} still unassigned.` : ""}`}
                confirmLabel="Publish"
                pending={publishing}
                onConfirm={handlePublish}
            />
        </div>
    );
}

function Summary({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" }) {
    return (
        <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`font-semibold tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}>
                {value}
            </p>
        </div>
    );
}
