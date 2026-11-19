"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Mail, MessageSquare, Phone, ShieldAlert } from "lucide-react";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { Avatar, Badge, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { getEmployeeProfile, resendInvite, updateEmployeeProfile } from "@/lib/api/team";
import { resetStaffPin } from "@/lib/api/kiosk";
import { useManager } from "@/components/manager/manager-context";
import { LoginDetails } from "./login-details";
import { openDirectMessage } from "@/lib/api/messaging";
import { useQuery } from "@/lib/hooks/use-query";
import { formatDate, titleCase } from "@/lib/format";
import type { EmployeeProfile, EmployeeProfileUpdate, EmploymentType } from "@/lib/types";

type Props = { userId: number | null; onClose: () => void; onSaved: () => void };

type Draft = {
    hourly_rate: string;
    employment_type: EmploymentType;
    max_hours_week: string;
    overtime_eligible: boolean;
    phone: string;
    emergency_contact: string;
    emergency_phone: string;
    notes: string;
};

function toDraft(p: EmployeeProfile): Draft {
    return {
        hourly_rate: p.hourly_rate != null ? String(p.hourly_rate) : "",
        employment_type: p.employment_type,
        max_hours_week: p.max_hours_week != null ? String(p.max_hours_week) : "",
        overtime_eligible: p.overtime_eligible,
        phone: p.phone ?? "",
        emergency_contact: p.emergency_contact ?? "",
        emergency_phone: p.emergency_phone ?? "",
        notes: p.notes ?? "",
    };
}

const PHONE_RE = /^[+()\d\s.-]{7,20}$/;

export function EmployeeDialog({ userId, onClose, onSaved }: Props) {
    const toast = useToast();
    const router = useRouter();
    const profile = useQuery(userId ? ["profile", userId] : null, () => getEmployeeProfile(userId!));
    const [draft, setDraft] = useState<Draft | null>(null);
    const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [confirmDeactivate, setConfirmDeactivate] = useState(false);
    const [confirmResend, setConfirmResend] = useState(false);
    const [resending, setResending] = useState(false);
    // Login details to hand over in person, when the resent email didn't go out.
    const [unsent, setUnsent] = useState<{ email: string; password: string } | null>(null);
    const { user, canApprove } = useManager();

    // Re-seed the form whenever a (re)loaded or saved profile arrives.
    const [seeded, setSeeded] = useState(profile.data);
    if (profile.data !== seeded) {
        setSeeded(profile.data);
        setDraft(profile.data ? toDraft(profile.data) : null);
        setErrors({});
        setFormError(null);
        setUnsent(null);
    }

    const p = profile.data;
    const name = p ? p.display_name || p.username : "";
    // Mirrors the backend rule: resending resets the password, so it never reaches an owner,
    // yourself, or (for managers) another manager or supervisor.
    const callerRole = user?.role?.toLowerCase() ?? "";
    const targetRole = p?.role?.toLowerCase() ?? "";
    const canResend =
        !!p &&
        p.invited &&
        p.status === "active" &&
        p.user_id !== user?.user_id &&
        targetRole !== "owner" &&
        (callerRole === "owner" || (callerRole === "manager" && targetRole !== "manager" && targetRole !== "supervisor"));

    async function handleResend() {
        if (!p || !p.location_id) return;
        setResending(true);
        try {
            const res = await resendInvite(p.user_id, p.location_id);
            setConfirmResend(false);
            if (res.email_sent || !res.temp_password) {
                toast.success("Invite resent", `${p.user_email} will get an email with new login details.`);
            } else {
                setUnsent({ email: p.user_email, password: res.temp_password });
            }
        } catch (err) {
            setConfirmResend(false);
            toast.error("Couldn't resend the invite", err instanceof Error ? err.message : undefined);
        } finally {
            setResending(false);
        }
    }

    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

    function validate(d: Draft): boolean {
        const next: typeof errors = {};
        if (d.hourly_rate && (isNaN(Number(d.hourly_rate)) || Number(d.hourly_rate) < 0)) next.hourly_rate = "Enter a positive amount.";
        if (d.max_hours_week && (!Number.isInteger(Number(d.max_hours_week)) || Number(d.max_hours_week) < 1 || Number(d.max_hours_week) > 168))
            next.max_hours_week = "Whole hours between 1 and 168.";
        if (d.phone && !PHONE_RE.test(d.phone)) next.phone = "That doesn't look like a phone number.";
        if (d.emergency_phone && !PHONE_RE.test(d.emergency_phone)) next.emergency_phone = "That doesn't look like a phone number.";
        setErrors(next);
        return !Object.keys(next).length;
    }

    async function save(update: EmployeeProfileUpdate, success: string) {
        if (!userId) return;
        setSaving(true);
        setFormError(null);
        try {
            const updated = await updateEmployeeProfile(userId, update);
            profile.setData(updated);
            toast.success(success);
            onSaved();
            return updated;
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Couldn't save changes.");
        } finally {
            setSaving(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!draft || !validate(draft)) return;
        await save(
            {
                hourly_rate: draft.hourly_rate ? Number(draft.hourly_rate) : null,
                employment_type: draft.employment_type,
                max_hours_week: draft.max_hours_week ? Number(draft.max_hours_week) : null,
                overtime_eligible: draft.overtime_eligible,
                phone: draft.phone,
                emergency_contact: draft.emergency_contact,
                emergency_phone: draft.emergency_phone,
                notes: draft.notes,
            },
            "Profile saved"
        );
    }

    async function handleDeactivate() {
        const updated = await save({ status: "inactive" }, `${name} deactivated`);
        setConfirmDeactivate(false);
        if (updated) onClose();
    }

    async function handleMessage() {
        if (!userId) return;
        try {
            const channel = await openDirectMessage(userId);
            router.push(`/manager/messaging?channel=${channel.channel_id}`);
        } catch (err) {
            toast.error("Couldn't open a conversation", err instanceof Error ? err.message : undefined);
        }
    }

    return (
        <>
            <Dialog
                open={userId !== null}
                onOpenChange={(o) => !o && !saving && onClose()}
                title={name || "Employee"}
                size="lg"
                footer={
                    p &&
                    draft && (
                        <>
                            {p.status === "active" && (
                                <Button
                                    variant="destructive"
                                    className="mr-auto"
                                    onClick={() => setConfirmDeactivate(true)}
                                    disabled={saving}
                                >
                                    Deactivate
                                </Button>
                            )}
                            {p.status === "inactive" && (
                                <Button variant="outline" className="mr-auto" onClick={() => save({ status: "active" }, `${name} reactivated`)} disabled={saving}>
                                    Reactivate
                                </Button>
                            )}
                            <Button variant="ghost" onClick={onClose} disabled={saving}>
                                Close
                            </Button>
                            <Button type="submit" form="employee-form" disabled={saving}>
                                {saving ? "Saving…" : "Save changes"}
                            </Button>
                        </>
                    )
                }
            >
                {profile.error ? (
                    <ErrorState message={profile.error.message} onRetry={profile.refetch} />
                ) : !p || !draft ? (
                    <div className="space-y-3">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-40" />
                    </div>
                ) : (
                    <div className="space-y-5">
                        <div className="flex flex-wrap items-center gap-4">
                            <Avatar name={name} className="size-12 text-sm" />
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone="primary">{p.role ?? "No role"}</Badge>
                                    <Badge tone={p.status === "active" ? "success" : "neutral"}>{titleCase(p.status)}</Badge>
                                    {p.hire_date && (
                                        <span className="text-xs text-muted-foreground">
                                            Since {formatDate(p.hire_date, { year: "numeric", weekday: undefined })}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                    <a href={`mailto:${p.user_email}`} className="flex items-center gap-1.5 hover:text-foreground">
                                        <Mail className="size-3.5" /> {p.user_email}
                                    </a>
                                    {p.phone && (
                                        <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 hover:text-foreground">
                                            <Phone className="size-3.5" /> {p.phone}
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {canResend && (
                                    <Button variant="outline" onClick={() => setConfirmResend(true)} disabled={resending}>
                                        <KeyRound /> Resend invite
                                    </Button>
                                )}
                                <Button variant="outline" onClick={handleMessage}>
                                    <MessageSquare /> Message
                                </Button>
                            </div>
                        </div>

                        {unsent && <LoginDetails email={unsent.email} password={unsent.password} />}

                        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="clock-pin-status">
                            <KeyRound className="size-4 text-muted-foreground" />
                            <span className="flex-1">
                                Clock-in PIN for the punch-in tablet:{" "}
                                <span className="font-medium">{p.kiosk_pin_set ? "set" : "not set yet"}</span>
                                <span className="block text-xs text-muted-foreground">Staff choose it in the ProShifts app. It&apos;s private: nobody else can see it.</span>
                            </span>
                            {p.kiosk_pin_set && canApprove && p.user_id !== user?.user_id && (
                                <Button variant="ghost" size="sm" onClick={async () => {
                                    try {
                                        await resetStaffPin(p.user_id);
                                        toast.success("PIN reset", `${name} can set a new one in the app.`);
                                        await profile.refetch();
                                    } catch (err) {
                                        toast.error("Couldn't reset the PIN", err instanceof Error ? err.message : undefined);
                                    }
                                }}>Reset PIN</Button>
                            )}
                        </div>

                        <form id="employee-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
                            <FormError message={formError} />

                            <fieldset className="grid gap-4 sm:grid-cols-2">
                                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Employment
                                </legend>
                                <Field label="Employment type" htmlFor="emp-type">
                                    <Select
                                        id="emp-type"
                                        value={draft.employment_type}
                                        onChange={(e) => set("employment_type", e.target.value as EmploymentType)}
                                    >
                                        <option value="full_time">Full time</option>
                                        <option value="part_time">Part time</option>
                                        <option value="casual">Casual</option>
                                    </Select>
                                </Field>
                                <Field label="Hourly rate" htmlFor="emp-rate" error={errors.hourly_rate} hint="Used for labor cost.">
                                    <Input
                                        id="emp-rate"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        inputMode="decimal"
                                        value={draft.hourly_rate}
                                        onChange={(e) => set("hourly_rate", e.target.value)}
                                        aria-invalid={!!errors.hourly_rate}
                                    />
                                </Field>
                                <Field label="Max hours / week" htmlFor="emp-max" error={errors.max_hours_week}>
                                    <Input
                                        id="emp-max"
                                        type="number"
                                        min={1}
                                        max={168}
                                        inputMode="numeric"
                                        value={draft.max_hours_week}
                                        onChange={(e) => set("max_hours_week", e.target.value)}
                                        aria-invalid={!!errors.max_hours_week}
                                    />
                                </Field>
                                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={draft.overtime_eligible}
                                        onChange={(e) => set("overtime_eligible", e.target.checked)}
                                        className="size-4 accent-primary"
                                    />
                                    Eligible for overtime
                                </label>
                            </fieldset>

                            <fieldset className="grid gap-4 sm:grid-cols-2">
                                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Contact
                                </legend>
                                <Field label="Phone" htmlFor="emp-phone" error={errors.phone}>
                                    <Input id="emp-phone" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!errors.phone} />
                                </Field>
                                <div className="hidden sm:block" />
                                <Field label="Emergency contact" htmlFor="emp-ec">
                                    <Input id="emp-ec" value={draft.emergency_contact} onChange={(e) => set("emergency_contact", e.target.value)} />
                                </Field>
                                <Field label="Emergency phone" htmlFor="emp-ep" error={errors.emergency_phone}>
                                    <Input id="emp-ep" type="tel" value={draft.emergency_phone} onChange={(e) => set("emergency_phone", e.target.value)} aria-invalid={!!errors.emergency_phone} />
                                </Field>
                            </fieldset>

                            <Field label="Manager notes" htmlFor="emp-notes" hint="Only visible to managers.">
                                <Textarea id="emp-notes" value={draft.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} />
                            </Field>

                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <ShieldAlert className="size-3.5" /> Name, email and role are managed by the employee and onboarding.
                            </p>
                        </form>
                    </div>
                )}
            </Dialog>

            <ConfirmDialog
                open={confirmResend}
                onOpenChange={setConfirmResend}
                title={`Resend invite to ${name}?`}
                description={`${p?.user_email ?? "They"} will get a new temporary password for the mobile app. Their current password will stop working.`}
                confirmLabel="Resend invite"
                pending={resending}
                onConfirm={handleResend}
            />

            <ConfirmDialog
                open={confirmDeactivate}
                onOpenChange={setConfirmDeactivate}
                title={`Deactivate ${name}?`}
                description="They'll lose access to this location and drop off the team list. Past shifts and timesheets are kept, and you can reactivate them later."
                confirmLabel="Deactivate"
                destructive
                pending={saving}
                onConfirm={handleDeactivate}
            />
        </>
    );
}
