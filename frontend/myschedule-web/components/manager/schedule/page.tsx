"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CopyPlus, GanttChart, Plus, Rows3, Send, Sparkles, Users } from "lucide-react";
import { WeekNav } from "@/components/manager/schedule/week-nav";
import { WeekGrid } from "@/components/manager/schedule/week-grid";
import { ShiftFormDialog } from "@/components/manager/schedule/shift-form-dialog";
import { ShiftDetailDialog } from "@/components/manager/schedule/shift-detail-dialog";
import { ScheduleCopilotDialog } from "@/components/manager/ai/schedule-copilot-dialog";
import { BulkAddDialog } from "@/components/manager/schedule/bulk-add-dialog";
import { CopyShiftsDialog, type CopyRequest } from "@/components/manager/schedule/copy-shifts-dialog";
import { StaffGrid } from "@/components/manager/schedule/staff-grid";
import { DayTimeline } from "@/components/manager/schedule/day-timeline";
import { useShiftMover } from "@/components/manager/schedule/use-shift-mover";
import {
    EMPTY_FILTERS, ScheduleFilterPanel, activeCount, applyFilters, needsStatus, type ScheduleFilters,
} from "@/components/manager/schedule/schedule-filters";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { getLaborCost, getWeekStatus, listShifts, publishWeek, rolesWithStaff } from "@/lib/api/shifts";
import { useQuery } from "@/lib/hooks/use-query";
import { useLiveRefresh } from "@/lib/hooks/use-socket";
import { addDaysToKey, dateKeyIn, formatHours, formatKey, formatMoney, mondayOfKey, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Shift } from "@/lib/types";

type View = "week" | "staff" | "day";
const VIEWS: { id: View; label: string; icon: typeof Rows3; hint: string }[] = [
    { id: "week", label: "Week", icon: CalendarDays, hint: "Drag a shift to another day" },
    { id: "staff", label: "By staff", icon: Rows3, hint: "Drag to another person or day" },
    { id: "day", label: "Day timeline", icon: GanttChart, hint: "Drag up/down to change the time" },
];

export default function SchedulePage() {
    const { location, locations, setLocationId, timezone: tz } = useManager();
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

    const [view, setView] = useState<View>("week");
    const [filters, setFilters] = useState<ScheduleFilters>(EMPTY_FILTERS);
    const [timelineDay, setTimelineDay] = useState<string | null>(null);
    // Clock-in / conflict data is only fetched when a filter needs it.
    const status = useQuery(
        locationId && needsStatus(filters) ? ["week-status", locationId, weekKey] : null,
        () => getWeekStatus(locationId!, weekKey)
    );

    // Another manager (or the AI generator) changing this location's schedule.
    useLiveRefresh(locationId, ["shift:updated", "schedule:published"], () => {
        void shifts.refetch();
        void labor.refetch();
        if (needsStatus(filters)) void status.refetch();
    });

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<Shift | null>(null);
    const [newDate, setNewDate] = useState<string | null>(null);
    const [selected, setSelected] = useState<Shift | null>(null);
    const [confirmPublish, setConfirmPublish] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [copilotOpen, setCopilotOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [copyReq, setCopyReq] = useState<CopyRequest | null>(null);
    const [loadingLastWeek, setLoadingLastWeek] = useState(false);

    function refreshWeek() {
        void shifts.refetch();
        void labor.refetch();
    }

    const shortDate = (k: string) => formatKey(k, { weekday: undefined, month: "short", day: "numeric", year: undefined });
    const weekRange = (k: string) => `${shortDate(k)} – ${shortDate(addDaysToKey(k, 6))}`;

    async function openCopyLastWeek() {
        if (!locationId) return;
        setLoadingLastWeek(true);
        try {
            const prevKey = addDaysToKey(weekKey, -7);
            const prev = (await listShifts(locationId, prevKey)).filter((s) => s.status !== "cancelled");
            if (!prev.length) {
                toast.info("Nothing to copy", `There are no shifts in the week of ${weekRange(prevKey)}.`);
                return;
            }
            setCopyReq({ mode: "week", title: "Copy last week", shifts: prev, fromLabel: weekRange(prevKey), toLabel: weekRange(weekKey) });
        } catch (err) {
            toast.error("Couldn't load last week", err instanceof Error ? err.message : undefined);
        } finally {
            setLoadingLastWeek(false);
        }
    }

    const names = useMemo(() => {
        const map = new Map<number, string>();
        roles.data?.forEach((r) => r.employees.forEach((e) => map.set(e.user_id, e.name)));
        return map;
    }, [roles.data]);

    const list = useMemo(() => shifts.data ?? [], [shifts.data]);
    const roleOf = useMemo(() => {
        const map = new Map<number, string>();
        roles.data?.forEach((r) => r.employees.forEach((e) => map.set(e.user_id, e.role ?? r.role_name)));
        return map;
    }, [roles.data]);
    const statusMap = useMemo(
        () => (status.data ? new Map(status.data.map((i) => [`${i.shift_id}|${i.user_id}`, i])) : null),
        [status.data]
    );
    const filtered = useMemo(() => applyFilters(list, filters, tz, roleOf, statusMap), [list, filters, tz, roleOf, statusMap]);
    // Rows/columns in the staff and day views follow the employee and role filters.
    const visibleUserIds = useMemo(() => {
        if (filters.userId) return new Set([Number(filters.userId)]);
        if (filters.role) return new Set([...roleOf].filter(([, r]) => r === filters.role).map(([u]) => u));
        if (activeCount(filters)) return new Set(filtered.flatMap((s) => s.assignments.map((a) => a.user_id)));
        return null;
    }, [filters, roleOf, filtered]);
    const showOpen = !filters.userId && filters.assignment !== "assigned" && !filters.clock && !filters.flag;
    const dayForTimeline = filters.day || timelineDay || (todayKey(tz) >= weekKey && todayKey(tz) <= addDaysToKey(weekKey, 6) ? todayKey(tz) : weekKey);

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

    const mover = useShiftMover((shift) => {
        upsert(shift);
        if (needsStatus(filters)) void status.refetch();
    }, names);

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
                    <Button variant="outline" size="lg" onClick={openCopyLastWeek} disabled={loadingLastWeek || !locationId}>
                        <CopyPlus /> Copy last week
                    </Button>
                    <Button variant="outline" size="lg" onClick={() => setBulkOpen(true)} disabled={!locationId}>
                        <Users /> Bulk add
                    </Button>
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

            {locationId && (
                <ScheduleFilterPanel
                    value={filters}
                    onChange={setFilters}
                    weekStart={weekKey}
                    roles={roles.data ?? []}
                    locations={locations}
                    locationId={locationId}
                    onLocation={setLocationId}
                    statusLoading={status.loading}
                    shown={filtered.length}
                    total={list.length}
                />
            )}
            {status.error && <ErrorState message={`Couldn't load clock-in data: ${status.error.message}`} onRetry={status.refetch} />}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" aria-label="Schedule view" className="inline-flex rounded-lg border border-border bg-card p-0.5">
                    {VIEWS.map((v) => {
                        const Icon = v.icon;
                        return (
                            <button
                                key={v.id}
                                role="tab"
                                aria-selected={view === v.id}
                                onClick={() => setView(v.id)}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                    view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Icon className="size-4" /> {v.label}
                            </button>
                        );
                    })}
                </div>
                {view === "day" && !filters.day ? (
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Day">
                        {Array.from({ length: 7 }, (_, i) => addDaysToKey(weekKey, i)).map((d) => (
                            <button
                                key={d}
                                onClick={() => setTimelineDay(d)}
                                aria-pressed={d === dayForTimeline}
                                className={cn(
                                    "rounded-md border px-2 py-1 text-xs",
                                    d === dayForTimeline ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {formatKey(d, { weekday: "short", month: undefined, day: undefined })} {Number(d.slice(8, 10))}
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">{VIEWS.find((v) => v.id === view)?.hint} · changes are checked before they&apos;re saved</p>
                )}
            </div>

            {shifts.loading ? (
                <div className="grid grid-cols-7 gap-3">
                    {Array.from({ length: 7 }, (_, i) => (
                        <Skeleton key={i} className="h-[400px]" />
                    ))}
                </div>
            ) : view === "week" ? (
                <WeekGrid
                    weekStart={weekKey}
                    tz={tz}
                    shifts={filtered}
                    names={names}
                    onAddShift={openCreate}
                    onShiftClick={setSelected}
                    onCopyDay={(day, dayShifts) =>
                        setCopyReq({ mode: "days", title: `Copy ${formatKey(day, { weekday: "long", month: "short", day: "numeric" })}`, shifts: dayShifts, sourceDate: day })
                    }
                    onDropShift={(shift, day) =>
                        mover.move(shift, { date: day }, `Shift moved to ${formatKey(day, { weekday: "long", month: "short", day: "numeric" })}`)
                    }
                    busyId={mover.busyId}
                />
            ) : view === "staff" ? (
                <StaffGrid
                    weekStart={weekKey}
                    tz={tz}
                    shifts={filtered}
                    roles={roles.data ?? []}
                    names={names}
                    visibleUserIds={visibleUserIds}
                    showOpenRow={showOpen}
                    onShiftClick={setSelected}
                    onAddShift={openCreate}
                    onDropShift={mover.move}
                    busyId={mover.busyId}
                />
            ) : (
                <DayTimeline
                    day={dayForTimeline}
                    tz={tz}
                    shifts={filtered}
                    roles={roles.data ?? []}
                    names={names}
                    visibleUserIds={visibleUserIds}
                    showOpenColumn={showOpen}
                    onShiftClick={setSelected}
                    onDropShift={mover.move}
                    busyId={mover.busyId}
                />
            )}
            {mover.dialog}

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
                <BulkAddDialog
                    open={bulkOpen}
                    onOpenChange={setBulkOpen}
                    locationId={locationId}
                    weekStart={weekKey}
                    tz={tz}
                    roles={roles.data ?? []}
                    names={names}
                    onCreated={refreshWeek}
                />
            )}

            {locationId && (
                <CopyShiftsDialog
                    request={copyReq}
                    onClose={() => setCopyReq(null)}
                    locationId={locationId}
                    weekStart={weekKey}
                    tz={tz}
                    names={names}
                    onCopied={refreshWeek}
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
                onReplace={(shift, from, to) =>
                    mover.move(shift, { from_user_id: from, to_user_id: to }, `${names.get(to) ?? "They"} replaced ${names.get(from) ?? "them"}`)
                }
                onDuplicate={(shift) => {
                    setSelected(null);
                    setCopyReq({
                        mode: "days",
                        title: "Duplicate shift",
                        shifts: [shift],
                        sourceDate: dateKeyIn(shift.start_time, tz),
                    });
                }}
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
