"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form";
import { copyShifts, type CopyResult } from "@/lib/api/shifts";
import { addDaysToKey, dateKeyIn, formatKey, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Shift } from "@/lib/types";

/**
 * Two ways to copy:
 *  - "days": copy the given shifts onto days the manager picks (duplicate a shift, copy a day)
 *  - "week": copy the given shifts (a whole week) forward by 7 days
 */
export type CopyRequest =
    | { mode: "days"; title: string; shifts: Shift[]; sourceDate: string }
    | { mode: "week"; title: string; shifts: Shift[]; fromLabel: string; toLabel: string };

type Props = {
    request: CopyRequest | null;
    onClose: () => void;
    locationId: number;
    /** Monday of the week being viewed ("YYYY-MM-DD" at the location). */
    weekStart: string;
    tz: string;
    names: Map<number, string>;
    onCopied: () => void;
};

export function CopyShiftsDialog({ request, onClose, locationId, weekStart, tz, names, onCopied }: Props) {
    const [dates, setDates] = useState<Set<string>>(new Set());
    const [withStaff, setWithStaff] = useState(true);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<CopyResult | null>(null);

    // Fresh state each time a new copy is started.
    const [current, setCurrent] = useState<CopyRequest | null>(null);
    if (request !== current) {
        setCurrent(request);
        setDates(new Set());
        setWithStaff(true);
        setError(null);
        setResult(null);
    }

    if (!request) return null;
    const today = todayKey(tz);
    const live = request.shifts.filter((s) => s.status !== "cancelled");
    const assignedCount = live.reduce((n, s) => n + s.assignments.length, 0);

    // Two weeks of targets: the week on screen and the next one.
    const weeks = [0, 7].map((offset) => Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, offset + i)));

    const items =
        request.mode === "week"
            ? live.map((s) => ({ shift_id: s.shift_id, date: addDaysToKey(dateKeyIn(s.start_time, tz), 7) }))
            : live.flatMap((s) => [...dates].sort().map((d) => ({ shift_id: s.shift_id, date: d })));

    async function submit() {
        if (!items.length) return;
        setPending(true);
        setError(null);
        try {
            const res = await copyShifts(locationId, items, withStaff);
            setResult(res);
            onCopied();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't copy the shifts.");
        } finally {
            setPending(false);
        }
    }

    function toggle(d: string) {
        setDates((prev) => {
            const next = new Set(prev);
            if (next.has(d)) next.delete(d);
            else next.add(d);
            return next;
        });
    }

    const count = live.length;
    const description =
        request.mode === "week"
            ? `${count} shift${count === 1 ? "" : "s"} from ${request.fromLabel} will be copied into ${request.toLabel} as drafts.`
            : `Copy ${count === 1 ? "this shift" : `${count} shifts`} to the days you pick. Copies are drafts until you publish.`;

    return (
        <Dialog
            open
            onOpenChange={(o) => !o && !pending && onClose()}
            title={request.title}
            description={result ? undefined : description}
            footer={
                result ? (
                    <Button onClick={onClose}>Done</Button>
                ) : (
                    <>
                        <Button variant="ghost" onClick={onClose} disabled={pending}>
                            Cancel
                        </Button>
                        <Button onClick={submit} disabled={pending || items.length === 0}>
                            <Copy /> {pending ? "Copying…" : `Copy ${items.length} shift${items.length === 1 ? "" : "s"}`}
                        </Button>
                    </>
                )
            }
        >
            {result ? (
                <ResultView result={result} names={names} />
            ) : (
                <div className="space-y-4">
                    <FormError message={error} />
                    {count === 0 && <p className="text-sm text-muted-foreground">There are no shifts to copy.</p>}

                    {request.mode === "days" && count > 0 && (
                        <div className="space-y-3">
                            {weeks.map((week, w) => (
                                <div key={w}>
                                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">{w === 0 ? "This week" : "Next week"}</p>
                                    <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={w === 0 ? "This week" : "Next week"}>
                                        {week.map((d) => {
                                            const disabled = d < today || d === request.sourceDate;
                                            const on = dates.has(d);
                                            return (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    disabled={disabled}
                                                    aria-pressed={on}
                                                    onClick={() => toggle(d)}
                                                    title={d === request.sourceDate ? "This is the original day" : d < today ? "In the past" : undefined}
                                                    className={cn(
                                                        "rounded-md border px-1 py-1.5 text-center text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                                                        on ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground enabled:hover:bg-muted"
                                                    )}
                                                >
                                                    <span className="block text-[10px] uppercase text-muted-foreground">
                                                        {formatKey(d, { weekday: "short", month: undefined, day: undefined })}
                                                    </span>
                                                    {Number(d.slice(8, 10))}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {request.mode === "week" && count > 0 && (
                        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                            {live.map((s) => (
                                <li key={s.shift_id}>
                                    {formatKey(dateKeyIn(s.start_time, tz), { weekday: "short", month: "short", day: "numeric" })} →{" "}
                                    {formatKey(addDaysToKey(dateKeyIn(s.start_time, tz), 7), { weekday: "short", month: "short", day: "numeric" })}
                                    {s.role ? ` · ${s.role}` : ""}
                                    {s.assignments.length ? ` · ${s.assignments.map((a) => names.get(a.user_id) ?? "Staff").join(", ")}` : " · open"}
                                </li>
                            ))}
                        </ul>
                    )}

                    {assignedCount > 0 && (
                        <label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" checked={withStaff} onChange={(e) => setWithStaff(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
                            <span>
                                Copy assigned staff too
                                <span className="block text-xs text-muted-foreground">
                                    Anyone on time off, double-booked or no longer active is left off, and that shift stays open.
                                </span>
                            </span>
                        </label>
                    )}
                </div>
            )}
        </Dialog>
    );
}

function ResultView({ result, names }: { result: CopyResult; names: Map<number, string> }) {
    const problems = [
        ...result.unassigned.map((u) => `${u.name ?? names.get(u.user_id) ?? "Someone"} on ${formatKey(u.date, { weekday: "short", month: "short", day: "numeric" })}: ${u.reason}. The shift was copied without them.`),
        ...result.skipped.map((s) => s.reason),
    ];
    return (
        <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="size-4 text-success" />
                Copied {result.created_count} shift{result.created_count === 1 ? "" : "s"} as drafts.
            </p>
            {result.filled_count > 0 && (
                <p className="text-sm text-foreground">
                    Filled {result.filled_count} open shift{result.filled_count === 1 ? "" : "s"} that were already in the same slot.
                </p>
            )}
            {problems.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <AlertTriangle className="size-4 text-warning" /> Needs a look ({problems.length})
                    </p>
                    <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto text-xs text-foreground">
                        {problems.map((p, i) => (
                            <li key={i}>• {p}</li>
                        ))}
                    </ul>
                </div>
            )}
            <p className="text-xs text-muted-foreground">Review them on the schedule, then publish when ready.</p>
        </div>
    );
}
