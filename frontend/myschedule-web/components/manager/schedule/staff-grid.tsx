"use client";

import { useEffect, useState } from "react";
import { UserX } from "lucide-react";
import { ShiftCard } from "./shift-card";
import { DRAG_MIME, dragState, type DragItem } from "./drag-state";
import { addDaysToKey, dateKeyIn, formatHours, formatKey, shiftHours, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoveTarget, RoleWithStaff, Shift } from "@/lib/types";

type Row = { userId: number | null; name: string; role: string | null };

type Props = {
    weekStart: string;
    tz: string;
    shifts: Shift[];
    roles: RoleWithStaff[];
    names: Map<number, string>;
    /** Only these people get a row (filters); undefined = everyone. */
    visibleUserIds?: Set<number> | null;
    showOpenRow?: boolean;
    onShiftClick: (shift: Shift) => void;
    onAddShift: (dateKey: string) => void;
    onDropShift: (shift: Shift, target: MoveTarget, label: string) => void;
    busyId?: number | null;
};

/** What dropping `item` on (row, day) means, or why it can't go there. */
export function dropFor(item: DragItem, row: Row, day: string, tz: string, names: Map<number, string>):
    { target: MoveTarget; label: string } | { invalid: string } | null {
    const { shift, fromUserId } = item;
    const sameDay = dateKeyIn(shift.start_time, tz) === day;
    const date = sameDay ? undefined : day;
    const onShift = new Set(shift.assignments.map((a) => a.user_id));
    const when = sameDay ? "" : ` on ${formatKey(day, { weekday: "short", month: "short", day: "numeric" })}`;

    if (row.userId === null) {
        if (fromUserId !== null) return { invalid: "Open the shift from its details to take someone off" };
        return sameDay ? null : { target: { date }, label: `Open shift moved${when}` };
    }
    if (row.userId === fromUserId) {
        return sameDay ? null : { target: { date }, label: `Shift moved${when}` };
    }
    if (onShift.has(row.userId)) return { invalid: `${row.name} is already on this shift` };
    return {
        target: { date, from_user_id: fromUserId, to_user_id: row.userId },
        label: fromUserId === null
            ? `${row.name} assigned${when}`
            : `Moved from ${names.get(fromUserId) ?? "them"} to ${row.name}${when}`,
    };
}

export function StaffGrid({ weekStart, tz, shifts, roles, names, visibleUserIds, showOpenRow = true, onShiftClick, onAddShift, onDropShift, busyId }: Props) {
    const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
    const today = todayKey(tz);
    const [over, setOver] = useState<string | null>(null);
    // Drag cancelled (Esc, dropped outside): clear the highlight.
    useEffect(() => dragState.subscribe(() => !dragState.get() && setOver(null)), []);

    // One row per person (sorted by role, then name), plus open shifts on top.
    const seen = new Set<number>();
    const people: Row[] = roles
        .flatMap((r) => r.employees.map((e) => ({ userId: e.user_id, name: e.name, role: e.role ?? r.role_name })))
        .filter((r) => (seen.has(r.userId!) ? false : (seen.add(r.userId!), true)))
        .filter((r) => !visibleUserIds || visibleUserIds.has(r.userId!))
        .sort((a, b) => (a.role ?? "").localeCompare(b.role ?? "") || a.name.localeCompare(b.name));
    const rows: Row[] = [...(showOpenRow ? [{ userId: null, name: "Open shifts", role: null }] : []), ...people];

    const cell = new Map<string, Shift[]>();
    const hours = new Map<number, number>();
    for (const s of shifts) {
        const d = dateKeyIn(s.start_time, tz);
        const ids = s.assignments.length ? s.assignments.map((a) => a.user_id) : [null];
        for (const uid of ids) {
            const k = `${uid ?? "open"}|${d}`;
            cell.set(k, [...(cell.get(k) ?? []), s]);
            if (uid !== null && s.status !== "cancelled") hours.set(uid, (hours.get(uid) ?? 0) + shiftHours(s.start_time, s.end_time, s.break_minutes));
        }
    }

    const item = dragState.get();

    return (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="min-w-[980px] overflow-hidden rounded-lg border border-border bg-card" role="grid" aria-label="Schedule by staff">
                <div className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/40 text-xs" role="row">
                    <div className="px-3 py-2 font-medium text-muted-foreground" role="columnheader">Staff</div>
                    {days.map((d) => (
                        <div key={d} role="columnheader" className={cn("px-2 py-2 font-semibold", d === today ? "text-primary" : "text-foreground")}>
                            {formatKey(d, { weekday: "short", month: undefined, day: undefined })} {Number(d.slice(8, 10))}
                        </div>
                    ))}
                </div>
                {rows.map((row) => (
                    <div key={row.userId ?? "open"} role="row" className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] border-b border-border last:border-b-0">
                        <div className="flex flex-col justify-center gap-0.5 border-r border-border px-3 py-2" role="rowheader">
                            <span className={cn("flex items-center gap-1 truncate text-sm font-medium", row.userId === null && "text-destructive")}>
                                {row.userId === null && <UserX className="size-3.5" />}
                                {row.name}
                            </span>
                            <span className="truncate text-[11px] text-muted-foreground">
                                {row.userId === null ? "Drag onto someone to assign" : `${row.role ?? ""}${hours.get(row.userId) ? ` · ${formatHours(Math.round(hours.get(row.userId)! * 10) / 10)}` : ""}`}
                            </span>
                        </div>
                        {days.map((d) => {
                            const k = `${row.userId ?? "open"}|${d}`;
                            const result = item ? dropFor(item, row, d, tz, names) : null;
                            const invalid = !!result && "invalid" in result;
                            return (
                                <div
                                    key={d}
                                    role="gridcell"
                                    data-cell={k}
                                    title={over === k && invalid ? (result as { invalid: string }).invalid : undefined}
                                    onDragOver={(e) => {
                                        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                                        e.preventDefault();
                                        // Read the live drag, not this render's copy (first dragover precedes a re-render).
                                        const it = dragState.get();
                                        const r = it ? dropFor(it, row, d, tz, names) : null;
                                        e.dataTransfer.dropEffect = !r || "invalid" in r ? "none" : "move";
                                        if (over !== k) setOver(k);
                                    }}
                                    onDragLeave={(e) => {
                                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === k ? null : o));
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setOver(null);
                                        const it = dragState.get();
                                        dragState.set(null);
                                        if (!it) return;
                                        const r = dropFor(it, row, d, tz, names);
                                        if (r && "target" in r) onDropShift(it.shift, r.target, r.label);
                                    }}
                                    onDoubleClick={() => onAddShift(d)}
                                    className={cn(
                                        "min-h-[64px] space-y-1.5 border-r border-border p-1.5 transition-colors last:border-r-0",
                                        d === today && "bg-primary/[0.03]",
                                        over === k && result && !invalid && "bg-primary/10 ring-2 ring-inset ring-primary/40",
                                        over === k && invalid && "bg-destructive/5 ring-2 ring-inset ring-destructive/40"
                                    )}
                                >
                                    {(cell.get(k) ?? []).map((s) => (
                                        <ShiftCard
                                            key={s.shift_id}
                                            shift={s}
                                            tz={tz}
                                            names={names}
                                            onlyName={row.userId === null ? undefined : row.name}
                                            onClick={() => onShiftClick(s)}
                                            draggable
                                            dragUserId={row.userId}
                                            busy={busyId === s.shift_id}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                ))}
                {rows.length === (showOpenRow ? 1 : 0) && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">No staff match these filters.</p>
                )}
            </div>
        </div>
    );
}
