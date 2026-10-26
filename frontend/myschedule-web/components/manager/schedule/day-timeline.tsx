"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MoonStar, UserX } from "lucide-react";
import { dateKeyIn, formatKey, formatTime, timeIn } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoveTarget, RoleWithStaff, Shift } from "@/lib/types";

const HOUR_PX = 44;
const SNAP_MIN = 15;
const DAY_MIN = 24 * 60;

type Col = { userId: number | null; name: string; role: string | null };

type Props = {
    day: string;
    tz: string;
    shifts: Shift[];
    roles: RoleWithStaff[];
    names: Map<number, string>;
    visibleUserIds?: Set<number> | null;
    showOpenColumn?: boolean;
    onShiftClick: (shift: Shift) => void;
    onDropShift: (shift: Shift, target: MoveTarget, label: string) => void;
    busyId?: number | null;
};

const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const label12 = (min: number) => {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "a.m." : "p.m."}`;
};

/** Wall-clock minutes of the shift on this day: start, and end (may pass midnight). */
function span(shift: Shift, tz: string) {
    const start = toMin(timeIn(shift.start_time, tz));
    let end = toMin(timeIn(shift.end_time, tz));
    const days = Math.round(
        (Date.parse(`${dateKeyIn(shift.end_time, tz)}T00:00:00Z`) - Date.parse(`${dateKeyIn(shift.start_time, tz)}T00:00:00Z`)) / 86_400_000
    );
    end += days * DAY_MIN;
    return { start, end };
}

type Drag = {
    shift: Shift;
    fromUserId: number | null;
    fromCol: number;
    startX: number;
    startY: number;
    origStart: number;
    length: number;
    dy: number;
    col: number;
    moved: boolean;
};

/**
 * One day, one column per person, time running down the page. Drag a shift up or down
 * to change its time (15-minute steps, length kept), or sideways onto someone else.
 * Nothing is saved while dragging; the drop is a single validated request.
 */
export function DayTimeline({ day, tz, shifts, roles, names, visibleUserIds, showOpenColumn = true, onShiftClick, onDropShift, busyId }: Props) {
    const scroller = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const dragRef = useRef<Drag | null>(null);
    dragRef.current = drag;

    const cols: Col[] = useMemo(() => {
        const seen = new Set<number>();
        const people = roles
            .flatMap((r) => r.employees.map((e) => ({ userId: e.user_id as number | null, name: e.name, role: e.role ?? r.role_name })))
            .filter((c) => (seen.has(c.userId!) ? false : (seen.add(c.userId!), true)))
            .filter((c) => !visibleUserIds || visibleUserIds.has(c.userId!))
            .sort((a, b) => (a.role ?? "").localeCompare(b.role ?? "") || a.name.localeCompare(b.name));
        return [...(showOpenColumn ? [{ userId: null, name: "Open", role: null }] : []), ...people];
    }, [roles, visibleUserIds, showOpenColumn]);

    const dayShifts = useMemo(() => shifts.filter((s) => dateKeyIn(s.start_time, tz) === day), [shifts, tz, day]);

    // Start the view just before the first shift (or 7 a.m.).
    useEffect(() => {
        const first = dayShifts.reduce((m, s) => Math.min(m, span(s, tz).start), 7 * 60);
        scroller.current?.scrollTo({ top: Math.max(first - 60, 0) / 60 * HOUR_PX });
    }, [day, tz, dayShifts]);

    useEffect(() => {
        if (!drag) return;
        function onMove(e: PointerEvent) {
            const d = dragRef.current;
            if (!d) return;
            const dy = Math.round(((e.clientY - d.startY) / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-col]");
            const col = el ? Number(el.dataset.col) : d.col;
            const moved = d.moved || Math.abs(e.clientY - d.startY) > 4 || Math.abs(e.clientX - d.startX) > 4;
            setDrag({ ...d, dy, col, moved });
        }
        function onUp() {
            const d = dragRef.current;
            setDrag(null);
            if (!d) return;
            if (!d.moved) {
                onShiftClick(d.shift);
                return;
            }
            const res = resolve(d);
            if (res && "target" in res) onDropShift(d.shift, res.target, res.label);
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setDrag(null);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("keydown", onKey);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag?.shift.shift_id]);

    function newStart(d: Drag) {
        return Math.min(Math.max(d.origStart + d.dy, 0), DAY_MIN - SNAP_MIN);
    }

    /** The move a drag describes, or why it can't be dropped there. */
    function resolve(d: Drag): { target: MoveTarget; label: string } | { invalid: string } | null {
        const start = newStart(d);
        const timeChanged = start !== d.origStart;
        const to = cols[d.col];
        const personChanged = d.col !== d.fromCol;
        if (!timeChanged && !personChanged) return null;
        const target: MoveTarget = timeChanged ? { start: toHHMM(start) } : {};
        const at = timeChanged ? ` to ${label12(start)}` : "";
        if (personChanged) {
            if (to.userId === null) return { invalid: "Open the shift's details to take someone off" };
            if (d.shift.assignments.some((a) => a.user_id === to.userId)) return { invalid: `${to.name} is already on this shift` };
            target.from_user_id = d.fromUserId;
            target.to_user_id = to.userId;
            return { target, label: d.fromUserId === null ? `${to.name} assigned${at}` : `Moved from ${names.get(d.fromUserId) ?? "them"} to ${to.name}${at}` };
        }
        return { target, label: `Shift moved${at}` };
    }

    const preview = drag?.moved ? resolve(drag) : null;
    const invalid = !!preview && "invalid" in preview;

    const blocksFor = (col: Col) =>
        dayShifts.filter((s) =>
            col.userId === null ? s.assignments.length === 0 : s.assignments.some((a) => a.user_id === col.userId)
        );

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{formatKey(day, { weekday: "long", month: "long", day: "numeric" })}</span>
                <span>Drag up or down to change the time · sideways to give it to someone else</span>
            </div>
            <div ref={scroller} className="max-h-[640px] overflow-auto" style={{ touchAction: drag ? "none" : undefined }}>
                <div className="flex" style={{ minWidth: 64 + cols.length * 132 }}>
                    {/* time gutter */}
                    <div className="sticky left-0 z-20 w-16 shrink-0 border-r border-border bg-card">
                        <div className="sticky top-0 z-10 h-10 border-b border-border bg-card" />
                        {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} style={{ height: HOUR_PX }} className="relative border-b border-border/50 pr-1 text-right text-[10px] text-muted-foreground">
                                <span className="relative -top-1.5">{h === 0 ? "" : label12(h * 60)}</span>
                            </div>
                        ))}
                    </div>
                    {cols.map((col, ci) => (
                        <div key={col.userId ?? "open"} data-col={ci} className={cn("relative w-[132px] shrink-0 border-r border-border last:border-r-0", drag?.moved && drag.col === ci && (invalid ? "bg-destructive/5" : "bg-primary/5"))}>
                            <div className="sticky top-0 z-10 flex h-10 flex-col justify-center border-b border-border bg-card px-2">
                                <span className={cn("flex items-center gap-1 truncate text-xs font-semibold", col.userId === null && "text-destructive")}>
                                    {col.userId === null && <UserX className="size-3" />}
                                    {col.name}
                                </span>
                                {col.role && <span className="truncate text-[10px] text-muted-foreground">{col.role}</span>}
                            </div>
                            <div className="relative" style={{ height: 24 * HOUR_PX }}>
                                {Array.from({ length: 24 }, (_, h) => (
                                    <div key={h} className="border-b border-border/50" style={{ height: HOUR_PX }} />
                                ))}
                                {blocksFor(col).map((s) => {
                                    const { start, end } = span(s, tz);
                                    const draggingThis = drag?.shift.shift_id === s.shift_id && drag.fromCol === ci;
                                    const top = (start / 60) * HOUR_PX;
                                    const height = Math.max(((Math.min(end, DAY_MIN) - start) / 60) * HOUR_PX, 18);
                                    const cancelled = s.status === "cancelled";
                                    return (
                                        <button
                                            key={s.shift_id}
                                            data-shift-id={s.shift_id}
                                            aria-busy={busyId === s.shift_id || undefined}
                                            onPointerDown={(e) => {
                                                if (e.button !== 0 || cancelled || busyId === s.shift_id) return;
                                                e.preventDefault();
                                                setDrag({ shift: s, fromUserId: col.userId, fromCol: ci, startX: e.clientX, startY: e.clientY, origStart: start, length: end - start, dy: 0, col: ci, moved: false });
                                            }}
                                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onShiftClick(s)}
                                            className={cn(
                                                "absolute inset-x-1 z-[1] flex flex-col items-start justify-start overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm select-none",
                                                s.status === "published" ? "border-success/40 bg-success/15" : s.status === "draft" ? "border-warning/40 bg-warning/15" : "border-border bg-muted opacity-50",
                                                !cancelled && "cursor-grab",
                                                draggingThis && drag!.moved && "opacity-30"
                                            )}
                                            style={{ top, height }}
                                            title="Drag to move · click for details"
                                        >
                                            <span className="block font-semibold text-foreground">{formatTime(s.start_time, tz)} – {formatTime(s.end_time, tz)}</span>
                                            {s.role && <span className="block truncate text-muted-foreground">{s.role}</span>}
                                            {end > DAY_MIN && (
                                                <span className="absolute bottom-0.5 right-1 flex items-center gap-0.5 text-[10px] text-primary">
                                                    <MoonStar className="size-3" /> next day
                                                </span>
                                            )}
                                            {busyId === s.shift_id && <Loader2 className="absolute right-1 top-1 size-3 animate-spin text-primary" />}
                                        </button>
                                    );
                                })}
                                {drag?.moved && drag.col === ci && (() => {
                                    const st = newStart(drag);
                                    return (
                                        <div
                                            aria-hidden
                                            className={cn(
                                                "pointer-events-none absolute inset-x-1 z-[2] rounded-md border-2 border-dashed px-1.5 py-1 text-[11px] font-semibold",
                                                invalid ? "border-destructive bg-destructive/10 text-destructive" : "border-primary bg-primary/15 text-primary"
                                            )}
                                            style={{ top: (st / 60) * HOUR_PX, height: Math.max(((Math.min(st + drag.length, DAY_MIN) - st) / 60) * HOUR_PX, 18) }}
                                        >
                                            {invalid ? (preview as { invalid: string }).invalid : `${label12(st)} – ${label12((st + drag.length) % DAY_MIN)}`}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
