"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MoonStar, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select } from "@/components/ui/form";
import { bulkCreateWeek, type BulkResult } from "@/lib/api/shifts";
import { addDaysToKey, formatKey, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RoleWithStaff } from "@/lib/types";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: number;
    /** Monday of the week being viewed ("YYYY-MM-DD" at the location). */
    weekStart: string;
    tz: string;
    roles: RoleWithStaff[];
    names: Map<number, string>;
    onCreated: () => void;
};

function minutes(hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

export function BulkAddDialog({ open, onOpenChange, locationId, weekStart, tz, roles, names, onCreated }: Props) {
    const [start, setStart] = useState("09:00");
    const [end, setEnd] = useState("17:00");
    const [breakMinutes, setBreakMinutes] = useState("30");
    const [roleChoice, setRoleChoice] = useState("own");
    const [days, setDays] = useState<Set<number>>(new Set());
    const [people, setPeople] = useState<Set<number>>(new Set());
    const [query, setQuery] = useState("");
    const [includeUnavailable, setIncludeUnavailable] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState<BulkResult | null>(null);
    // Row order sent to the API, so every skipped row can be named.
    const [submitted, setSubmitted] = useState<number[]>([]);

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setDays(new Set());
            setPeople(new Set());
            setQuery("");
            setIncludeUnavailable(false);
            setError(null);
            setResult(null);
        }
    }

    const today = todayKey(tz);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
    const roleOf = useMemo(() => {
        const m = new Map<number, number | null>();
        roles.forEach((r) => r.employees.forEach((e) => m.set(e.user_id, r.role_id)));
        return m;
    }, [roles]);

    const q = query.trim().toLowerCase();
    const groups = roles
        .map((r) => ({ ...r, employees: r.employees.filter((e) => !q || e.name.toLowerCase().includes(q)) }))
        .filter((r) => r.employees.length > 0);

    const overnight = start && end && minutes(end) <= minutes(start);
    const lengthMin = start && end ? (minutes(end) - minutes(start) + (overnight ? 1440 : 0)) : 0;
    const total = days.size * people.size;

    function togglePerson(id: number) {
        setPeople((p) => {
            const n = new Set(p);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });
    }

    function toggleGroup(ids: number[]) {
        setPeople((p) => {
            const n = new Set(p);
            const all = ids.every((id) => n.has(id));
            ids.forEach((id) => (all ? n.delete(id) : n.add(id)));
            return n;
        });
    }

    async function submit() {
        const brk = Number(breakMinutes || 0);
        if (!start || !end || start === end) return setError("Pick a start and end time.");
        if (!Number.isInteger(brk) || brk < 0 || brk >= lengthMin) return setError("The break must be shorter than the shift.");
        if (!days.size) return setError("Pick at least one day.");
        if (!people.size) return setError("Pick at least one person.");
        setError(null);
        setPending(true);
        const ids = [...people];
        setSubmitted(ids);
        try {
            const res = await bulkCreateWeek(
                locationId,
                weekStart,
                ids.map((uid) => ({
                    user_id: uid,
                    role_id: roleChoice === "own" ? roleOf.get(uid) ?? null : Number(roleChoice),
                    start_time: start,
                    end_time: end,
                    days: [...days].sort(),
                    break_minutes: brk,
                })),
                includeUnavailable
            );
            setResult(res);
            onCreated();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't create the shifts.");
        } finally {
            setPending(false);
        }
    }

    const weekLabel = `${formatKey(weekStart, { month: "short", day: "numeric", year: undefined })} – ${formatKey(addDaysToKey(weekStart, 6), { month: "short", day: "numeric" })}`;

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => !pending && onOpenChange(o)}
            size="lg"
            title="Bulk add shifts"
            description={result ? undefined : `Week of ${weekLabel}. One draft shift per person per day; conflicts are skipped.`}
            footer={
                result ? (
                    <>
                        <Button variant="ghost" onClick={() => setResult(null)}>
                            Add more
                        </Button>
                        <Button onClick={() => onOpenChange(false)}>Done</Button>
                    </>
                ) : (
                    <>
                        <span className="mr-auto text-sm text-muted-foreground" aria-live="polite">
                            {people.size} {people.size === 1 ? "person" : "people"} × {days.size} {days.size === 1 ? "day" : "days"} = <strong className="text-foreground">{total} shifts</strong>
                        </span>
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                            Cancel
                        </Button>
                        <Button onClick={submit} disabled={pending || total === 0}>
                            {pending ? "Creating…" : `Create ${total} shift${total === 1 ? "" : "s"}`}
                        </Button>
                    </>
                )
            }
        >
            {result ? (
                <BulkResultView result={result} names={names} rowUsers={submitted} />
            ) : (
                <div className="space-y-5">
                    <FormError message={error} />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Field label="Start" htmlFor="bulk-start">
                            <Input id="bulk-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                        </Field>
                        <Field label="End" htmlFor="bulk-end">
                            <Input id="bulk-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                        </Field>
                        <Field label="Break (min)" htmlFor="bulk-break">
                            <Input id="bulk-break" type="number" min={0} step={5} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
                        </Field>
                        <Field label="Role" htmlFor="bulk-role">
                            <Select id="bulk-role" value={roleChoice} onChange={(e) => setRoleChoice(e.target.value)}>
                                <option value="own">Each person&apos;s role</option>
                                {roles
                                    .filter((r) => r.role_id !== null)
                                    .map((r) => (
                                        <option key={r.role_id!} value={r.role_id!}>
                                            {r.role_name}
                                        </option>
                                    ))}
                            </Select>
                        </Field>
                    </div>
                    {overnight && (
                        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MoonStar className="size-3.5" /> Overnight: ends the next day.
                        </p>
                    )}

                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Days</p>
                            <button
                                type="button"
                                className="text-xs font-medium text-primary hover:underline"
                                onClick={() => setDays(new Set(weekDays.map((d, i) => (d >= today ? i : -1)).filter((i) => i >= 0 && i < 5)))}
                            >
                                Weekdays
                            </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Days">
                            {weekDays.map((d, i) => {
                                const on = days.has(i);
                                return (
                                    <button
                                        key={d}
                                        type="button"
                                        aria-pressed={on}
                                        disabled={d < today}
                                        title={d < today ? "In the past" : undefined}
                                        onClick={() =>
                                            setDays((s) => {
                                                const n = new Set(s);
                                                if (n.has(i)) n.delete(i);
                                                else n.add(i);
                                                return n;
                                            })
                                        }
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

                    <div>
                        <div className="mb-1.5 flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">Staff</p>
                            <label className="relative w-48">
                                <span className="sr-only">Search staff</span>
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-8 pl-8 text-xs" />
                            </label>
                        </div>
                        {groups.length === 0 ? (
                            <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                                <Users className="size-4" /> {q ? "No one matches that search." : "No active staff at this location yet."}
                            </p>
                        ) : (
                            <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                                {groups.map((g) => {
                                    const ids = g.employees.map((e) => e.user_id);
                                    const all = ids.every((id) => people.has(id));
                                    return (
                                        <div key={g.role_id ?? "none"}>
                                            <div className="mb-1 flex items-center justify-between">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.role_name}</p>
                                                <button type="button" onClick={() => toggleGroup(ids)} className="text-xs font-medium text-primary hover:underline">
                                                    {all ? "Clear" : "Select all"}
                                                </button>
                                            </div>
                                            <div className="grid gap-1 sm:grid-cols-2">
                                                {g.employees.map((e) => (
                                                    <label key={e.user_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                                                        <input
                                                            type="checkbox"
                                                            checked={people.has(e.user_id)}
                                                            onChange={() => togglePerson(e.user_id)}
                                                            className="size-4 accent-primary"
                                                        />
                                                        {e.name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <label className="flex items-start gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={includeUnavailable}
                            onChange={(e) => setIncludeUnavailable(e.target.checked)}
                            className="mt-0.5 size-4 accent-primary"
                        />
                        <span>
                            Include people outside their availability
                            <span className="block text-xs text-muted-foreground">
                                Off: anyone not available on a day is skipped and listed afterwards. Time off and double-booking are always skipped.
                            </span>
                        </span>
                    </label>
                </div>
            )}
        </Dialog>
    );
}

function BulkResultView({ result, names, rowUsers }: { result: BulkResult; names: Map<number, string>; rowUsers: number[] }) {
    return (
        <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="size-4 text-success" />
                Created {result.created_count} draft shift{result.created_count === 1 ? "" : "s"}.
            </p>
            {result.skipped.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <AlertTriangle className="size-4 text-warning" /> Skipped ({result.skipped.length})
                    </p>
                    <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto text-xs text-foreground">
                        {result.skipped.map((s, i) => (
                            <li key={i}>
                                • {names.get(s.user_id ?? rowUsers[s.index]) ?? "Someone"}
                                {s.day ? ` on ${s.day}` : ""}: {s.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <p className="text-xs text-muted-foreground">They&apos;re drafts: review them on the schedule, then publish when ready.</p>
        </div>
    );
}
