"use client";

import { useMemo, useState } from "react";
import { MoonStar } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { assignUser, createShift, updateShift } from "@/lib/api/shifts";
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
    };
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
    const paidHours = times
        ? Math.max(times.spanHours - Number(form.breakMinutes || 0) / 60, 0)
        : 0;

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
            if (brk / 60 >= span) next.breakMinutes = "Break must be shorter than the shift.";
        }
        setErrors(next);
        return Object.keys(next).length === 0;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setFormError(null);
        if (!validate() || !times) return;
        setSaving(true);
        const payload = {
            // Naive wall-clock time: the API attaches the location's timezone.
            start_time: times.startIso,
            end_time: times.endIso,
            break_minutes: Number(form.breakMinutes || 0),
            role_id: form.roleId ? Number(form.roleId) : null,
            notes: form.notes.trim() || null,
        };
        try {
            let saved: Shift;
            if (editing && shift) {
                saved = await updateShift(shift.shift_id, payload);
                toast.success("Shift updated");
            } else {
                saved = await createShift({ ...payload, location_id: locationId });
                if (form.userId) {
                    try {
                        await assignUser(saved.shift_id, Number(form.userId));
                        saved = {
                            ...saved,
                            assignments: [{ user_id: Number(form.userId), assigned_at: new Date().toISOString() }],
                        };
                        toast.success("Shift created and assigned");
                    } catch (err) {
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
            onSaved(saved);
            onOpenChange(false);
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
                    <Field label="Break (min)" htmlFor="shift-break" error={errors.breakMinutes}>
                        <Input
                            id="shift-break"
                            type="number"
                            min={0}
                            step={5}
                            inputMode="numeric"
                            value={form.breakMinutes}
                            onChange={(e) => set("breakMinutes", e.target.value)}
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
        </Dialog>
    );
}
