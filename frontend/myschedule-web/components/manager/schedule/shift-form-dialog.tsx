"use client";

import { useMemo, useState } from "react";
import { Coffee, MoonStar, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { assignUser, createShift, editShift, isOutsideAvailability } from "@/lib/api/shifts";
import { addDaysToKey, dateKeyIn, formatHours, naiveLocalIso, timeIn, todayKey } from "@/lib/format";
import type { RoleWithStaff, Shift } from "@/lib/types";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: number;
    roles: RoleWithStaff[];
    /** Present when editing. */
    shift?: Shift | null;
    /** Pre-selected day when creating. */
    /** Pre-selected day ("YYYY-MM-DD" at the location) when creating. */
    defaultDate?: string | null;
    /** Location timezone: the form edits wall-clock time at the location. */
    tz: string;
    onSaved: (shift: Shift) => void;
};

type FormState = {
    date: string;
    start: string;
    end: string;
    breakMinutes: string;
    roleId: string;
    userId: string;
    notes: string;
    /** Planned breaks, wall-clock "HH:MM" at the location. */
    breaks: { start: string; end: string }[];
};

const MAX_SHIFT_HOURS = 16;

function initialState(
    shift: Shift | null | undefined,
    defaultDate: string | null | undefined,
    roles: RoleWithStaff[],
    tz: string
): FormState {
    if (shift) {
        const role = roles.find((r) => r.role_name === shift.role && r.role_id !== null);
        return {
            date: dateKeyIn(shift.start_time, tz),
            start: timeIn(shift.start_time, tz),
            end: timeIn(shift.end_time, tz),
            breakMinutes: String(shift.break_minutes ?? 0),
            roleId: role?.role_id ? String(role.role_id) : "",
            userId: "",
            notes: shift.notes ?? "",
            breaks: (shift.breaks ?? []).map((b) => ({ start: timeIn(b.start_time, tz), end: timeIn(b.end_time, tz) })),
        };
    }
    return {
        date: defaultDate ?? todayKey(tz),
        start: "09:00",
        end: "17:00",
        breakMinutes: "30",
        roleId: "",
        userId: "",
        notes: "",
        breaks: [],
    };
}

const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
};

/** A break time on the shift's calendar: before the start means after midnight (overnight). */
function breakIso(f: FormState, hhmm: string) {
    return naiveLocalIso(toMinutes(hhmm) < toMinutes(f.start) ? addDaysToKey(f.date, 1) : f.date, hhmm);
}

/** Minutes of a break, measured from the shift start so overnight breaks work. */
function breakSpan(f: FormState, b: { start: string; end: string }) {
    const rel = (t: string) => (toMinutes(t) - toMinutes(f.start) + 24 * 60) % (24 * 60);
    return { from: rel(b.start), to: rel(b.end) };
}

type ResolvedTimes = {
    /** Wall-clock times at the location, as the API expects them. */
    startIso: string;
    endIso: string;
    overnight: boolean;
    /** Scheduled length in hours (wall-clock; ignores the rare DST night). */
    spanHours: number;
};

/** An end time at or before the start rolls into the next day (overnight shift). */
function resolveTimes(f: FormState): ResolvedTimes | null {
    if (!f.date || !f.start || !f.end) return null;
    const toMin = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
    };
    const overnight = toMin(f.end) <= toMin(f.start);
    const spanMin = toMin(f.end) - toMin(f.start) + (overnight ? 24 * 60 : 0);
    return {
        startIso: naiveLocalIso(f.date, f.start),
        endIso: naiveLocalIso(overnight ? addDaysToKey(f.date, 1) : f.date, f.end),
        overnight,
        spanHours: spanMin / 60,
    };
}

export function ShiftFormDialog({ open, onOpenChange, locationId, roles, shift, defaultDate, tz, onSaved }: Props) {
    const toast = useToast();
    const editing = !!shift;
    const [form, setForm] = useState<FormState>(() => initialState(shift, defaultDate, roles, tz));
    const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    // Saving a time change would put someone on the shift outside their availability.
    const [pendingEdit, setPendingEdit] = useState<{ message: string } | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Reset whenever the dialog opens for a different shift/day (adjusting state on prop change).
    const openKey = open ? `${shift?.shift_id ?? "new"}-${defaultDate ?? ""}-${tz}` : null;
    const [prevKey, setPrevKey] = useState(openKey);
    if (openKey !== prevKey) {
        setPrevKey(openKey);
        if (openKey) {
            setForm(initialState(shift, defaultDate, roles, tz));
            setErrors({});
            setFormError(null);
        }
    }

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

    const times = resolveTimes(form);
    // With planned breaks, the break total is their sum.
    const plannedBreakMin = form.breaks.reduce((n, b) => {
        if (!b.start || !b.end) return n;
        const { from, to } = breakSpan(form, b);
        return n + Math.max(to - from, 0);
    }, 0);
    const breakMin = form.breaks.length ? plannedBreakMin : Number(form.breakMinutes || 0);
    const paidHours = times ? Math.max(times.spanHours - breakMin / 60, 0) : 0;

    // Employees for the chosen role, or everyone when no role is chosen.
    const employeeOptions = useMemo(() => {
        const pool = form.roleId ? roles.filter((r) => String(r.role_id) === form.roleId) : roles;
        const seen = new Set<number>();
        return pool
            .flatMap((r) => r.employees)
            .filter((e) => (seen.has(e.user_id) ? false : (seen.add(e.user_id), true)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [roles, form.roleId]);

    function validate(): boolean {
        const next: typeof errors = {};
        if (!form.date) next.date = "Pick a date.";
        if (!form.start) next.start = "Required.";
        if (!form.end) next.end = "Required.";
        const brk = Number(form.breakMinutes);
        if (form.breakMinutes !== "" && (!Number.isInteger(brk) || brk < 0)) next.breakMinutes = "Whole minutes, 0 or more.";
        if (times) {
            const span = times.spanHours;
            if (span > MAX_SHIFT_HOURS) next.end = `Shifts can't be longer than ${MAX_SHIFT_HOURS} hours.`;
            if (breakMin / 60 >= span) next.breakMinutes = "Break must be shorter than the shift.";
            const spans = form.breaks.map((b) => breakSpan(form, b));
            form.breaks.forEach((b, i) => {
                const { from, to } = spans[i];
                if (!b.start || !b.end) next.breaks = "Give every break a start and an end.";
                else if (to <= from) next.breaks = "A break must end after it starts.";
                else if (to > span * 60) next.breaks = "Breaks must be inside the shift.";
            });
            const sorted = [...spans].sort((a, b) => a.from - b.from);
            if (!next.breaks && sorted.some((x, i) => i > 0 && x.from < sorted[i - 1].to)) next.breaks = "Breaks can't overlap.";
        }
        setErrors(next);
        return Object.keys(next).length === 0;
    }

    // The shift was created but the chosen person is outside their availability.
    const [pendingAssign, setPendingAssign] = useState<{ shift: Shift; userId: number; message: string } | null>(null);

    function finish(saved: Shift) {
        onSaved(saved);
        onOpenChange(false);
    }

    async function assignAnyway() {
        if (!pendingAssign) return;
        const { shift: created, userId } = pendingAssign;
        setSaving(true);
        try {
            await assignUser(created.shift_id, userId, true);
            toast.success("Shift created and assigned");
            setPendingAssign(null);
            finish({ ...created, assignments: [{ user_id: userId, assigned_at: new Date().toISOString() }] });
        } catch (err) {
            setPendingAssign(null);
            toast.error("Shift created, but not assigned", err instanceof Error ? err.message : undefined);
            finish(created);
        } finally {
            setSaving(false);
        }
    }

    function leaveOpen() {
        if (!pendingAssign) return;
        toast.info("Shift created without anyone assigned", "Assign someone from the shift when you're ready.");
        const created = pendingAssign.shift;
        setPendingAssign(null);
        finish(created);
    }

    async function handleSubmit(e: React.FormEvent | null, allowOutside = false) {
        e?.preventDefault();
        setFormError(null);
        if (!validate() || !times) return;
        setSaving(true);
        const breaks = form.breaks.map((b) => ({ start_time: breakIso(form, b.start), end_time: breakIso(form, b.end) }));
        const payload = {
            // Naive wall-clock time: the API attaches the location's timezone.
            start_time: times.startIso,
            end_time: times.endIso,
            break_minutes: breakMin,
            role_id: form.roleId ? Number(form.roleId) : null,
            notes: form.notes.trim() || null,
        };
        try {
            let saved: Shift;
            if (editing && shift) {
                try {
                    const res = await editShift(shift.shift_id, {
                        ...payload,
                        // Only send breaks when there are (or were) planned ones.
                        ...(form.breaks.length || shift.breaks?.length ? { breaks } : {}),
                        allow_outside_availability: allowOutside,
                    });
                    saved = res.shift;
                    setPendingEdit(null);
                    toast.success("Shift updated", res.warnings.length ? res.warnings.join(" · ") : undefined);
                } catch (err) {
                    if (!allowOutside && isOutsideAvailability(err)) {
                        setPendingEdit({ message: err.message });
                        return;
                    }
                    throw err;
                }
            } else {
                saved = await createShift({ ...payload, location_id: locationId });
                if (breaks.length) {
                    saved = (await editShift(saved.shift_id, { breaks })).shift;
                }
                if (form.userId) {
                    try {
                        await assignUser(saved.shift_id, Number(form.userId));
                        saved = {
                            ...saved,
                            assignments: [{ user_id: Number(form.userId), assigned_at: new Date().toISOString() }],
                        };
                        toast.success("Shift created and assigned");
                    } catch (err) {
                        if (isOutsideAvailability(err)) {
                            // Ask before assigning; the shift itself is already saved.
                            setPendingAssign({ shift: saved, userId: Number(form.userId), message: err.message });
                            return;
                        }
                        // The shift exists; only the assignment was refused (e.g. overlap or time off).
                        toast.error(
                            "Shift created, but not assigned",
                            err instanceof Error ? err.message : "The employee couldn't be assigned."
                        );
                    }
                } else {
                    toast.success("Draft shift created", "Assign someone and publish the week when you're ready.");
                }
            }
            finish(saved);
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Couldn't save the shift.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => !saving && onOpenChange(o)}
            title={editing ? "Edit shift" : "New shift"}
            description={
                editing
                    ? shift?.status === "published"
                        ? "This shift is live — assigned staff will see the change."
                        : undefined
                    : "New shifts start as drafts until you publish the week."
            }
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="submit" form="shift-form" disabled={saving}>
                        {saving ? "Saving…" : editing ? "Save changes" : "Create shift"}
                    </Button>
                </>
            }
        >
            <form id="shift-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
                <FormError message={formError} />

                <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Date" htmlFor="shift-date" error={errors.date} className="sm:col-span-3">
                        <Input
                            id="shift-date"
                            type="date"
                            value={form.date}
                            onChange={(e) => set("date", e.target.value)}
                            aria-invalid={!!errors.date}
                            required
                        />
                    </Field>
                    <Field label="Start" htmlFor="shift-start" error={errors.start}>
                        <Input
                            id="shift-start"
                            type="time"
                            step={300}
                            value={form.start}
                            onChange={(e) => set("start", e.target.value)}
                            aria-invalid={!!errors.start}
                            required
                        />
                    </Field>
                    <Field label="End" htmlFor="shift-end" error={errors.end}>
                        <Input
                            id="shift-end"
                            type="time"
                            step={300}
                            value={form.end}
                            onChange={(e) => set("end", e.target.value)}
                            aria-invalid={!!errors.end}
                            required
                        />
                    </Field>
                    <Field label="Break (min)" htmlFor="shift-break" error={errors.breakMinutes} hint={form.breaks.length ? "Total of the planned breaks" : undefined}>
                        <Input
                            id="shift-break"
                            type="number"
                            min={0}
                            step={5}
                            inputMode="numeric"
                            value={form.breaks.length ? String(plannedBreakMin) : form.breakMinutes}
                            onChange={(e) => set("breakMinutes", e.target.value)}
                            readOnly={form.breaks.length > 0}
                            aria-invalid={!!errors.breakMinutes}
                        />
                    </Field>
                </div>

                {times && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {times.overnight && <MoonStar className="size-3.5 text-primary" />}
                        {times.overnight ? "Overnight — ends the next day. " : ""}
                        {formatHours(Math.round(paidHours * 10) / 10)} paid
                    </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Role" htmlFor="shift-role">
                        <Select
                            id="shift-role"
                            value={form.roleId}
                            onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value, userId: "" }))}
                        >
                            <option value="">Any role</option>
                            {roles
                                .filter((r) => r.role_id !== null)
                                .map((r) => (
                                    <option key={r.role_id} value={r.role_id!}>
                                        {r.role_name}
                                    </option>
                                ))}
                        </Select>
                    </Field>

                    {!editing && (
                        <Field
                            label="Employee"
                            htmlFor="shift-employee"
                            hint={employeeOptions.length ? "Optional — leave open to fill later." : "No active staff in this role."}
                        >
                            <Select
                                id="shift-employee"
                                value={form.userId}
                                onChange={(e) => set("userId", e.target.value)}
                                disabled={!employeeOptions.length}
                            >
                                <option value="">Unassigned</option>
                                {employeeOptions.map((emp) => (
                                    <option key={emp.user_id} value={emp.user_id}>
                                        {emp.name}
                                        {emp.role ? ` · ${emp.role}` : ""}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                </div>

                <fieldset className="space-y-2 rounded-lg border border-border p-3">
                    <legend className="flex items-center gap-1.5 px-1 text-sm font-medium text-foreground">
                        <Coffee className="size-3.5" /> Planned breaks
                    </legend>
                    {form.breaks.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            No set break times — staff take the {form.breakMinutes || 0} min above when it suits. Add breaks to schedule when they happen.
                        </p>
                    ) : (
                        form.breaks.map((b, i) => (
                            <div key={i} className="flex items-end gap-2">
                                <Field label={`Break ${i + 1} start`} htmlFor={`break-${i}-start`} className="flex-1">
                                    <Input id={`break-${i}-start`} type="time" step={300} value={b.start}
                                        onChange={(e) => setForm((f) => ({ ...f, breaks: f.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) }))} />
                                </Field>
                                <Field label="End" htmlFor={`break-${i}-end`} className="flex-1">
                                    <Input id={`break-${i}-end`} type="time" step={300} value={b.end}
                                        onChange={(e) => setForm((f) => ({ ...f, breaks: f.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) }))} />
                                </Field>
                                <Button type="button" variant="ghost" size="sm" aria-label={`Remove break ${i + 1}`}
                                    onClick={() => setForm((f) => ({ ...f, breaks: f.breaks.filter((_, j) => j !== i) }))}>
                                    <Trash2 />
                                </Button>
                            </div>
                        ))
                    )}
                    {errors.breaks && <p className="text-xs text-destructive">{errors.breaks}</p>}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            setForm((f) => {
                                // Suggest a 30-minute break halfway through the shift.
                                const mid = (toMinutes(f.start) + Math.round((resolveTimes(f)?.spanHours ?? 8) * 30)) % (24 * 60);
                                const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                                return { ...f, breaks: [...f.breaks, { start: hhmm(mid), end: hhmm((mid + 30) % (24 * 60)) }] };
                            })
                        }
                    >
                        <Plus /> Add break
                    </Button>
                </fieldset>

                <Field label="Notes" htmlFor="shift-notes" hint="Visible to assigned staff.">
                    <Textarea
                        id="shift-notes"
                        value={form.notes}
                        maxLength={500}
                        onChange={(e) => set("notes", e.target.value)}
                        placeholder="e.g. Opening — set up the patio"
                    />
                </Field>
            </form>
            <ConfirmDialog
                open={!!pendingEdit}
                onOpenChange={(o) => !o && !saving && setPendingEdit(null)}
                title="Save anyway?"
                description={`${pendingEdit?.message ?? ""}. Keep them on the shift at the new time?`}
                confirmLabel="Save anyway"
                pending={saving}
                onConfirm={() => void handleSubmit(null, true)}
            />
            <ConfirmDialog
                open={!!pendingAssign}
                onOpenChange={(o) => !o && !saving && leaveOpen()}
                title="Assign anyway?"
                description={`The shift was created. ${pendingAssign?.message ?? ""}. Assign them anyway, or leave the shift open?`}
                confirmLabel="Assign anyway"
                pending={saving}
                onConfirm={assignAnyway}
            />
        </Dialog>
    );
}
