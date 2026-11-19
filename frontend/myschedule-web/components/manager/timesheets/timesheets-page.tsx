"use client";

import { useState } from "react";
import { Clock, Coffee, History, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { WeekNav } from "@/components/manager/schedule/week-nav";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/form";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
    addWorkedBreak, correctEntry, deleteWorkedBreak, entryHistory, listWorked, updateWorkedBreak,
    type AuditRow, type WorkedEntry,
} from "@/lib/api/timesheets";
import { useQuery } from "@/lib/hooks/use-query";
import { addDaysToKey, dateKeyIn, formatDate, fromServerUtc, formatHours, formatTime, formatTimeRange, mondayOfKey, timeIn, todayKey } from "@/lib/format";

const ACTION_LABELS: Record<AuditRow["action"], string> = {
    clock_in: "Clock-in changed",
    clock_out: "Clock-out changed",
    break_added: "Break added",
    break_changed: "Break changed",
    break_removed: "Break removed",
};

/**
 * Worked time (time entries) — separate from the schedule. Owners and managers correct
 * clock-in/out and breaks here; every change needs a reason and is kept in the history.
 */
export default function TimesheetsPage() {
    const { location, timezone: tz, canApprove } = useManager();
    const locationId = location?.id ?? null;
    const [weekPick, setWeekPick] = useState<string | null>(null);
    const weekKey = weekPick ?? mondayOfKey(todayKey(tz));
    const entries = useQuery(locationId ? ["worked", locationId, weekKey] : null, () => listWorked(locationId!, weekKey));
    const [editing, setEditing] = useState<WorkedEntry | null>(null);
    const [history, setHistory] = useState<WorkedEntry | null>(null);

    const list = entries.data ?? [];
    const byDay = new Map<string, WorkedEntry[]>();
    list.forEach((e) => {
        const k = dateKeyIn(e.clock_in, tz);
        byDay.set(k, [...(byDay.get(k) ?? []), e]);
    });
    const totalMin = list.reduce((n, e) => n + (e.total_minutes ?? 0), 0);

    function replace(updated: WorkedEntry) {
        entries.setData((prev = []) => prev.map((e) => (e.entry_id === updated.entry_id ? updated : e)));
        setEditing((cur) => (cur?.entry_id === updated.entry_id ? updated : cur));
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
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-4" />
                    Worked time, not the schedule. {canApprove ? "Corrections need a reason and are kept in the history." : "Only owners and managers can correct it."}
                </p>
            </div>

            <div className="flex gap-8 rounded-xl border border-border bg-card px-5 py-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Entries</p><p className="font-semibold">{entries.data ? list.length : "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Paid time</p><p className="font-semibold">{entries.data ? formatHours(Math.round(totalMin / 6) / 10) : "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Corrected</p><p className="font-semibold">{entries.data ? list.filter((e) => e.corrected_at).length : "—"}</p></div>
            </div>

            {entries.error && <ErrorState message={entries.error.message} onRetry={entries.refetch} />}
            {entries.loading ? (
                <Skeleton className="h-64" />
            ) : list.length === 0 ? (
                <EmptyState icon={Clock} title="No time recorded this week" description="Clock-ins from the app and the punch-in tablet appear here." />
            ) : (
                Array.from({ length: 7 }, (_, i) => addDaysToKey(weekKey, i))
                    .filter((d) => byDay.has(d))
                    .map((d) => (
                        <Card key={d} className="overflow-hidden">
                            <h3 className="border-b border-border bg-muted/40 px-4 py-2 text-sm font-semibold">
                                {formatDate(d, { weekday: "long", month: "long", day: "numeric" })}
                            </h3>
                            <ul className="divide-y divide-border">
                                {byDay.get(d)!.map((e) => (
                                    <li key={e.entry_id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm" data-entry-id={e.entry_id}>
                                        <span className="w-40 font-medium">{e.employee_name ?? `#${e.user_id}`}</span>
                                        <span className="w-48 text-muted-foreground">
                                            {e.shift ? `Scheduled ${formatTimeRange(e.shift.start_time, e.shift.end_time, tz)}` : "No shift"}
                                        </span>
                                        <span className="w-48">
                                            Worked {formatTime(e.clock_in, tz)} – {e.clock_out ? formatTime(e.clock_out, tz) : <Badge tone="success">on the clock</Badge>}
                                        </span>
                                        <span className="flex w-28 items-center gap-1 text-muted-foreground">
                                            <Coffee className="size-3.5" /> {e.breaks.reduce((n, b) => n + (b.duration_minutes ?? 0), 0)} min
                                        </span>
                                        <span className="w-16 font-semibold tabular-nums">{e.total_minutes != null ? formatHours(Math.round(e.total_minutes / 6) / 10) : "—"}</span>
                                        {e.corrected_at && <Badge tone="warning">Corrected</Badge>}
                                        <span className="ml-auto flex gap-1">
                                            <Button variant="ghost" size="sm" onClick={() => setHistory(e)}>
                                                <History /> History
                                            </Button>
                                            {canApprove && (
                                                <Button variant="outline" size="sm" onClick={() => setEditing(e)} aria-label={`Correct ${e.employee_name ?? "entry"}`}>
                                                    <Pencil /> Correct
                                                </Button>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    ))
            )}

            <CorrectDialog entry={editing} tz={tz} onClose={() => setEditing(null)} onSaved={replace} />
            <HistoryDialog entry={history} tz={tz} onClose={() => setHistory(null)} />
        </div>
    );
}

/** "2026-10-26T09:05:00" (naive, location time) from an instant and an "HH:MM" edit. */
function localIso(baseIso: string, hhmm: string, tz: string) {
    // Times before the clock-in are the next day (overnight).
    const day = dateKeyIn(baseIso, tz);
    const [bh, bm] = timeIn(baseIso, tz).split(":").map(Number);
    const [h, m] = hhmm.split(":").map(Number);
    return `${h * 60 + m < bh * 60 + bm ? addDaysToKey(day, 1) : day}T${hhmm}:00`;
}

function CorrectDialog({ entry, tz, onClose, onSaved }: { entry: WorkedEntry | null; tz: string; onClose: () => void; onSaved: (e: WorkedEntry) => void }) {
    const toast = useToast();
    const [form, setForm] = useState({ in: "", out: "", reason: "" });
    const [newBreak, setNewBreak] = useState<{ start: string; end: string } | null>(null);
    const [breakEdits, setBreakEdits] = useState<Record<number, { start: string; end: string }>>({});
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [key, setKey] = useState<number | null>(null);
    if ((entry?.entry_id ?? null) !== key) {
        setKey(entry?.entry_id ?? null);
        if (entry) {
            setForm({ in: timeIn(entry.clock_in, tz), out: entry.clock_out ? timeIn(entry.clock_out, tz) : "", reason: "" });
            setBreakEdits(Object.fromEntries(entry.breaks.map((b) => [b.break_id, { start: timeIn(b.break_start, tz), end: b.break_end ? timeIn(b.break_end, tz) : "" }])));
            setNewBreak(null);
            setError(null);
        }
    }
    if (!entry) return null;
    const base = entry.clock_in;

    async function act(fn: () => Promise<WorkedEntry>, done: string) {
        if (form.reason.trim().length < 3) {
            setError("Add a reason first — it's saved with the change.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const saved = await fn();
            onSaved(saved);
            toast.success(done, `${entry!.employee_name ?? "Employee"} · reason saved in the history`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the correction.");
        } finally {
            setBusy(false);
        }
    }

    const changedTimes = form.in !== timeIn(entry.clock_in, tz) || (entry.clock_out ? form.out !== timeIn(entry.clock_out, tz) : !!form.out);

    return (
        <Dialog
            open
            onOpenChange={(o) => !o && !busy && onClose()}
            title={`Correct time · ${entry.employee_name ?? ""}`}
            description={`${formatDate(entry.clock_in, { weekday: "long", month: "long", day: "numeric" }, tz)}${entry.shift ? ` · scheduled ${formatTimeRange(entry.shift.start_time, entry.shift.end_time, tz)}` : ""}`}
            footer={<Button variant="ghost" onClick={onClose} disabled={busy}>Done</Button>}
        >
            <div className="space-y-4">
                <FormError message={error} />
                <Field label="Reason for the correction" htmlFor="corr-reason" hint="Required. Kept with every change below.">
                    <Textarea id="corr-reason" value={form.reason} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                        placeholder="e.g. Forgot to clock out — confirmed with the closing supervisor" />
                </Field>
                <div className="flex items-end gap-3">
                    <Field label="Clock in" htmlFor="corr-in" className="flex-1">
                        <Input id="corr-in" type="time" value={form.in} onChange={(e) => setForm((f) => ({ ...f, in: e.target.value }))} />
                    </Field>
                    <Field label="Clock out" htmlFor="corr-out" className="flex-1">
                        <Input id="corr-out" type="time" value={form.out} onChange={(e) => setForm((f) => ({ ...f, out: e.target.value }))} />
                    </Field>
                    <Button disabled={busy || !changedTimes} onClick={() => act(() => correctEntry(entry.entry_id, {
                        ...(form.in !== timeIn(entry.clock_in, tz) ? { clock_in: `${dateKeyIn(base, tz)}T${form.in}:00` } : {}),
                        ...(form.out && form.out !== (entry.clock_out ? timeIn(entry.clock_out, tz) : "") ? { clock_out: localIso(base, form.out, tz) } : {}),
                        reason: form.reason.trim(),
                    }), "Times corrected")}>
                        Save times
                    </Button>
                </div>

                <section className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-sm font-medium"><Coffee className="size-4" /> Breaks taken</h4>
                    {entry.breaks.length === 0 && !newBreak && <p className="text-xs text-muted-foreground">No breaks recorded.</p>}
                    {entry.breaks.map((b, i) => {
                        const ed = breakEdits[b.break_id] ?? { start: "", end: "" };
                        return (
                            <div key={b.break_id} className="flex items-end gap-2">
                                <Field label={`Break ${i + 1} start`} htmlFor={`wb-${b.break_id}-s`} className="flex-1">
                                    <Input id={`wb-${b.break_id}-s`} type="time" value={ed.start} onChange={(e) => setBreakEdits((x) => ({ ...x, [b.break_id]: { ...ed, start: e.target.value } }))} />
                                </Field>
                                <Field label="End" htmlFor={`wb-${b.break_id}-e`} className="flex-1">
                                    <Input id={`wb-${b.break_id}-e`} type="time" value={ed.end} onChange={(e) => setBreakEdits((x) => ({ ...x, [b.break_id]: { ...ed, end: e.target.value } }))} />
                                </Field>
                                <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => updateWorkedBreak(b.break_id, {
                                    break_start: localIso(base, ed.start, tz), break_end: localIso(base, ed.end, tz), reason: form.reason.trim(),
                                }), "Break changed")}>Save</Button>
                                <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove break ${i + 1}`}
                                    onClick={() => act(() => deleteWorkedBreak(b.break_id, form.reason.trim()), "Break removed")}><Trash2 /></Button>
                            </div>
                        );
                    })}
                    {newBreak ? (
                        <div className="flex items-end gap-2">
                            <Field label="New break start" htmlFor="wb-new-s" className="flex-1">
                                <Input id="wb-new-s" type="time" value={newBreak.start} onChange={(e) => setNewBreak({ ...newBreak, start: e.target.value })} />
                            </Field>
                            <Field label="End" htmlFor="wb-new-e" className="flex-1">
                                <Input id="wb-new-e" type="time" value={newBreak.end} onChange={(e) => setNewBreak({ ...newBreak, end: e.target.value })} />
                            </Field>
                            <Button size="sm" disabled={busy || !newBreak.start || !newBreak.end} onClick={() => act(async () => {
                                const saved = await addWorkedBreak(entry.entry_id, { break_start: localIso(base, newBreak.start, tz), break_end: localIso(base, newBreak.end, tz), reason: form.reason.trim() });
                                setNewBreak(null);
                                return saved;
                            }, "Break added")}>Add</Button>
                        </div>
                    ) : (
                        <Button variant="outline" size="sm" onClick={() => setNewBreak({ start: "", end: "" })}><Plus /> Add a break</Button>
                    )}
                </section>
            </div>
        </Dialog>
    );
}

function HistoryDialog({ entry, tz, onClose }: { entry: WorkedEntry | null; tz: string; onClose: () => void }) {
    const hist = useQuery(entry ? ["entry-history", entry.entry_id, entry.corrected_at ?? ""] : null, () => entryHistory(entry!.entry_id));
    if (!entry) return null;
    const fmt = (v: string | null) => {
        if (!v) return "—";
        return v.split("/").filter(Boolean).map((x) => formatTime(x, tz)).join("–");
    };
    return (
        <Dialog open onOpenChange={(o) => !o && onClose()} title={`History · ${entry.employee_name ?? ""}`}
            description="Every correction, with the original value. Entries are never overwritten silently.">
            {hist.loading ? <Skeleton className="h-24" /> : hist.error ? <ErrorState message={hist.error.message} /> : !hist.data?.length ? (
                <p className="text-sm text-muted-foreground">No corrections — this is exactly what was punched.</p>
            ) : (
                <ol className="space-y-3">
                    {hist.data.map((h) => (
                        <li key={h.audit_id} className="rounded-md border border-border p-3 text-sm">
                            <p className="font-medium">{ACTION_LABELS[h.action]}: {fmt(h.old_value)} → {fmt(h.new_value)}</p>
                            <p className="text-xs text-muted-foreground">{h.changed_by_name ?? "Someone"} · {formatDate(fromServerUtc(h.changed_at), { weekday: undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                            <p className="mt-1 text-xs">&ldquo;{h.reason}&rdquo;</p>
                        </li>
                    ))}
                </ol>
            )}
        </Dialog>
    );
}
