"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Clock, Coffee, Copy, MessageSquare, Pencil, StickyNote, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Avatar, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { assignUser, cancelShift, isOutsideAvailability, unassignUser } from "@/lib/api/shifts";
import { createShiftThread } from "@/lib/api/messaging";
import { formatDate, formatHours, formatTime, formatTimeRange, shiftHours } from "@/lib/format";
import { shiftStatusTone } from "@/lib/theme/tokens";
import type { RoleWithStaff, Shift } from "@/lib/types";

type Props = {
    shift: Shift | null;
    /** Location timezone for displayed dates and times. */
    tz: string;
    onOpenChange: (open: boolean) => void;
    roles: RoleWithStaff[];
    names: Map<number, string>;
    onEdit: (shift: Shift) => void;
    onChanged: (shift: Shift) => void;
    /** Copy this shift to other days. */
    onDuplicate?: (shift: Shift) => void;
    /** Hand this shift from one person to another in one validated change. */
    onReplace?: (shift: Shift, fromUserId: number, toUserId: number) => void;
};

export function ShiftDetailDialog({ shift, tz, onOpenChange, roles, names, onEdit, onChanged, onDuplicate, onReplace }: Props) {
    const toast = useToast();
    const [replacing, setReplacing] = useState<{ from: number; to: string } | null>(null);
    const [assignee, setAssignee] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmCancel, setConfirmCancel] = useState(false);
    // Set when the API says the person isn't available then; the manager may assign anyway.
    const [availabilityWarning, setAvailabilityWarning] = useState<{ userId: number; message: string } | null>(null);

    const candidates = useMemo(() => {
        if (!shift) return [];
        const assigned = new Set(shift.assignments.map((a) => a.user_id));
        const inRole = roles.filter((r) => !shift.role || r.role_name === shift.role);
        const pool = (inRole.length ? inRole : roles).flatMap((r) => r.employees);
        const seen = new Set<number>();
        return pool
            .filter((e) => !assigned.has(e.user_id) && !seen.has(e.user_id) && (seen.add(e.user_id), true))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [shift, roles]);

    if (!shift) return null;
    const status = shiftStatusTone[shift.status];
    const isCancelled = shift.status === "cancelled";
    const hours = shiftHours(shift.start_time, shift.end_time, shift.break_minutes);

    async function run<T>(key: string, fn: () => Promise<T>, success: string): Promise<T | undefined> {
        setBusy(key);
        try {
            const result = await fn();
            toast.success(success);
            return result;
        } catch (err) {
            toast.error("That didn't work", err instanceof Error ? err.message : undefined);
            return undefined;
        } finally {
            setBusy(null);
        }
    }

    async function handleAssign(override = false, forUser?: number) {
        if (!shift) return;
        const userId = forUser ?? Number(assignee);
        if (!userId) return;
        setBusy("assign");
        try {
            await assignUser(shift.shift_id, userId, override);
            toast.success(`${names.get(userId) ?? "Employee"} assigned`);
            setAssignee("");
            setAvailabilityWarning(null);
            onChanged({
                ...shift,
                assignments: [...shift.assignments, { user_id: userId, assigned_at: new Date().toISOString() }],
            });
        } catch (err) {
            if (!override && isOutsideAvailability(err)) {
                setAvailabilityWarning({ userId, message: err.message });
            } else {
                setAvailabilityWarning(null);
                toast.error("That didn't work", err instanceof Error ? err.message : undefined);
            }
        } finally {
            setBusy(null);
        }
    }

    async function handleUnassign(userId: number) {
        if (!shift) return;
        const ok = await run(`un-${userId}`, () => unassignUser(shift.shift_id, userId), "Removed from shift");
        if (ok !== undefined) {
            onChanged({ ...shift, assignments: shift.assignments.filter((a) => a.user_id !== userId) });
        }
    }

    async function handleCancel() {
        if (!shift) return;
        const updated = await run("cancel", () => cancelShift(shift.shift_id), "Shift cancelled");
        setConfirmCancel(false);
        if (updated) {
            onChanged(updated);
            onOpenChange(false);
        }
    }

    async function handleThread() {
        if (!shift) return;
        await run("thread", () => createShiftThread(shift.shift_id), "Shift thread ready in Messaging");
    }

    return (
        <>
            <Dialog
                open={!!shift}
                onOpenChange={onOpenChange}
                title={formatDate(shift.start_time, { weekday: "long", month: "long" }, tz)}
                description={shift.role ?? "Any role"}
                footer={
                    !isCancelled && (
                        <>
                            <Button
                                variant="destructive"
                                onClick={() => setConfirmCancel(true)}
                                disabled={!!busy}
                                className="mr-auto"
                            >
                                <Trash2 /> Cancel shift
                            </Button>
                            {onDuplicate && (
                                <Button variant="outline" onClick={() => onDuplicate(shift)} disabled={!!busy}>
                                    <Copy /> Duplicate
                                </Button>
                            )}
                            <Button variant="outline" onClick={() => onEdit(shift)} disabled={!!busy}>
                                <Pencil /> Edit
                            </Button>
                        </>
                    )
                }
            >
                <div className="space-y-5">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {shift.created_by_ai && <Badge tone="primary">AI generated</Badge>}
                        {shift.status === "draft" && (
                            <span className="text-xs text-muted-foreground">Staff won&apos;t see this until you publish the week.</span>
                        )}
                    </div>

                    <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                            <Clock className="size-4 text-muted-foreground" />
                            <dt className="sr-only">Time</dt>
                            <dd>{formatTimeRange(shift.start_time, shift.end_time, tz)}</dd>
                        </div>
                        <div className="flex items-center gap-2">
                            <Coffee className="size-4 text-muted-foreground" />
                            <dt className="sr-only">Break and paid hours</dt>
                            <dd>
                                {shift.break_minutes} min break · {formatHours(Math.round(hours * 10) / 10)} paid
                            </dd>
                        </div>
                        {!!shift.breaks?.length && (
                            <div className="col-span-2 flex items-start gap-2">
                                <Coffee className="mt-0.5 size-4 text-muted-foreground" />
                                <dt className="sr-only">Planned breaks</dt>
                                <dd className="text-muted-foreground">
                                    Breaks: {shift.breaks.map((b) => `${formatTime(b.start_time, tz)}–${formatTime(b.end_time, tz)}`).join(", ")}
                                </dd>
                            </div>
                        )}
                        {shift.notes && (
                            <div className="col-span-2 flex items-start gap-2">
                                <StickyNote className="mt-0.5 size-4 text-muted-foreground" />
                                <dt className="sr-only">Notes</dt>
                                <dd className="whitespace-pre-wrap text-muted-foreground">{shift.notes}</dd>
                            </div>
                        )}
                    </dl>

                    <section>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Assigned ({shift.assignments.length})
                        </h3>
                        {shift.assignments.length === 0 ? (
                            <p className="rounded-md bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                Nobody is assigned to this shift yet.
                            </p>
                        ) : (
                            <ul className="divide-y divide-border rounded-md border border-border">
                                {shift.assignments.map((a) => {
                                    const name = names.get(a.user_id) ?? `Employee #${a.user_id}`;
                                    if (replacing?.from === a.user_id) {
                                        return (
                                            <li key={a.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                                <span className="text-sm">Replace {name} with</span>
                                                <Select
                                                    aria-label={`Replace ${name} with`}
                                                    value={replacing.to}
                                                    onChange={(e) => setReplacing({ from: a.user_id, to: e.target.value })}
                                                    className="h-8 w-auto flex-1"
                                                >
                                                    <option value="">Choose someone…</option>
                                                    {candidates.map((c) => (
                                                        <option key={c.user_id} value={c.user_id}>{c.name}{c.role ? ` · ${c.role}` : ""}</option>
                                                    ))}
                                                </Select>
                                                <Button size="sm" disabled={!replacing.to} onClick={() => {
                                                    onReplace?.(shift, a.user_id, Number(replacing.to));
                                                    setReplacing(null);
                                                }}>Replace</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>Cancel</Button>
                                            </li>
                                        );
                                    }
                                    return (
                                        <li key={a.user_id} className="flex items-center gap-3 px-3 py-2">
                                            <Avatar name={name} className="size-7" />
                                            <span className="flex-1 text-sm">{name}</span>
                                            {!isCancelled && onReplace && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setReplacing({ from: a.user_id, to: "" })}
                                                    disabled={!!busy || !candidates.length}
                                                    aria-label={`Replace ${name}`}
                                                >
                                                    <ArrowLeftRight /> Replace
                                                </Button>
                                            )}
                                            {!isCancelled && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleUnassign(a.user_id)}
                                                    disabled={!!busy}
                                                    aria-label={`Remove ${name} from shift`}
                                                >
                                                    <UserMinus /> {busy === `un-${a.user_id}` ? "Removing…" : "Remove"}
                                                </Button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {!isCancelled && (
                            <div className="mt-3 flex gap-2">
                                <label htmlFor="assign-select" className="sr-only">
                                    Employee to assign
                                </label>
                                <Select
                                    id="assign-select"
                                    value={assignee}
                                    onChange={(e) => setAssignee(e.target.value)}
                                    disabled={!candidates.length || !!busy}
                                >
                                    <option value="">
                                        {candidates.length ? "Choose someone to assign…" : "No one else available"}
                                    </option>
                                    {candidates.map((c) => (
                                        <option key={c.user_id} value={c.user_id}>
                                            {c.name}
                                            {c.role ? ` · ${c.role}` : ""}
                                        </option>
                                    ))}
                                </Select>
                                <Button onClick={() => handleAssign()} disabled={!assignee || !!busy} className="h-auto">
                                    <UserPlus /> {busy === "assign" ? "Assigning…" : "Assign"}
                                </Button>
                            </div>
                        )}
                    </section>

                    {!isCancelled && (
                        <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
                            <span className="text-muted-foreground">Coordinate with this shift&apos;s staff</span>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={handleThread} disabled={!!busy}>
                                    <MessageSquare /> Start thread
                                </Button>
                                <Link
                                    href="/manager/messaging"
                                    className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline"
                                >
                                    Open messaging
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </Dialog>

            <ConfirmDialog
                open={!!availabilityWarning}
                onOpenChange={(o) => !o && setAvailabilityWarning(null)}
                title={`Assign ${availabilityWarning ? names.get(availabilityWarning.userId) ?? "them" : "them"} anyway?`}
                description={`${availabilityWarning?.message ?? ""}. Check with them before assigning.`}
                confirmLabel="Assign anyway"
                pending={busy === "assign"}
                onConfirm={() => availabilityWarning && handleAssign(true, availabilityWarning.userId)}
            />

            <ConfirmDialog
                open={confirmCancel}
                onOpenChange={setConfirmCancel}
                title="Cancel this shift?"
                description={
                    shift.assignments.length
                        ? "Assigned staff will be notified that the shift is cancelled. This can't be undone."
                        : "The shift will be marked cancelled. This can't be undone."
                }
                confirmLabel="Cancel shift"
                destructive
                pending={busy === "cancel"}
                onConfirm={handleCancel}
            />
        </>
    );
}
