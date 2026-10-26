"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, CalendarOff, Check, Inbox, LogOut, X } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
    decideDrop,
    decideSwap,
    decideTimeOff,
    listPendingDrops,
    listPendingSwaps,
    listPendingTimeOff,
} from "@/lib/api/requests";
import { listStaff } from "@/lib/api/team";
import { useQuery } from "@/lib/hooks/use-query";
import { formatDate, formatRelative, formatTimeRange, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RequestShift, ShiftConflict, TimeOffRequest } from "@/lib/types";

type Tab = "swaps" | "drops" | "timeoff";

export default function RequestsPage() {
    const { location, pending, refreshPending, canApprove } = useManager();
    const locationId = location?.id ?? null;
    const [tab, setTab] = useState<Tab>("swaps");

    const swaps = useQuery(locationId ? ["swaps", locationId] : null, () => listPendingSwaps(locationId!));
    const drops = useQuery(locationId ? ["drops", locationId] : null, () => listPendingDrops(locationId!));
    const timeOff = useQuery(["timeoff"], listPendingTimeOff);
    // Fallback names for older API responses that only carry user_id.
    const staff = useQuery(locationId ? ["staff", locationId] : null, () => listStaff(locationId!));
    const nameOf = (userId: number, given?: string | null) =>
        given ||
        staff.data?.find((s) => s.user_id === userId)?.display_name ||
        staff.data?.find((s) => s.user_id === userId)?.username ||
        `Employee #${userId}`;

    const tabs: { id: Tab; label: string; icon: typeof Inbox; count?: number }[] = [
        { id: "swaps", label: "Shift swaps", icon: ArrowLeftRight, count: swaps.data?.length ?? pending?.swaps },
        { id: "drops", label: "Shift drops", icon: LogOut, count: drops.data?.length ?? pending?.drops },
        { id: "timeoff", label: "Time off", icon: CalendarOff, count: timeOff.data?.length ?? pending?.timeOff },
    ];

    function after(remove: () => void) {
        remove();
        void refreshPending();
    }

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-lg font-semibold text-foreground">Requests</h2>
                <p className="text-sm text-muted-foreground">
                    {canApprove
                        ? "Review what your team has asked for. Staff are notified as soon as you decide."
                        : "Only owners and managers can approve requests. You can review them here."}
                </p>
            </div>

            <div role="tablist" aria-label="Request type" className="flex gap-1 overflow-x-auto border-b border-border">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(t.id)}
                            className={cn(
                                "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Icon className="size-4" />
                            {t.label}
                            {!!t.count && (
                                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-primary text-primary-foreground" : "bg-muted")}>
                                    {t.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {tab === "swaps" && (
                <RequestList
                    loading={swaps.loading}
                    error={swaps.error?.message}
                    onRetry={swaps.refetch}
                    empty="No swaps waiting for approval"
                    emptyHint="Swaps appear here once both employees have agreed to trade."
                    items={(swaps.data ?? []).map((s) => {
                        const conflicts = [...(s.conflicts?.requester ?? []), ...(s.conflicts?.receiver ?? [])];
                        return (
                            <RequestCard
                                key={s.swap_id}
                                name={s.requester.name ?? "Employee"}
                                created={s.created_at}
                                title={
                                    s.receiver
                                        ? `Swap with ${s.receiver.name}`
                                        : "Open swap"
                                }
                                reason={s.reason}
                                canApprove={canApprove}
                                conflicts={conflicts}
                                onDecide={async (approve) => {
                                    const res = await decideSwap(s.swap_id, approve);
                                    after(() => swaps.setData((list = []) => list.filter((x) => x.swap_id !== s.swap_id)));
                                    return res.conflicts && (res.conflicts.requester.length || res.conflicts.receiver.length)
                                        ? "Approved with scheduling conflicts — check the schedule."
                                        : undefined;
                                }}
                            >
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <ShiftBox label={`${s.requester.name ?? "Requester"} gives up`} shift={s.shift} />
                                    {s.offered_shift ? (
                                        <ShiftBox label={`${s.receiver?.name ?? "Receiver"} gives up`} shift={s.offered_shift} />
                                    ) : (
                                        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                                            {s.receiver?.name ?? "The other employee"} takes the shift without trading one back.
                                        </div>
                                    )}
                                </div>
                            </RequestCard>
                        );
                    })}
                />
            )}

            {tab === "drops" && (
                <RequestList
                    loading={drops.loading}
                    error={drops.error?.message}
                    onRetry={drops.refetch}
                    empty="No drop requests"
                    emptyHint="When someone asks to be taken off a shift, it shows up here."
                    items={(drops.data ?? []).map((d) => (
                        <RequestCard
                            key={d.drop_id}
                            name={nameOf(d.user_id, d.employee?.name)}
                            created={d.created_at}
                            title="Wants to drop a shift"
                            reason={d.reason}
                            canApprove={canApprove}
                            approveHint="Approving removes them from the shift and leaves it unassigned."
                            onDecide={async (approve) => {
                                await decideDrop(d.drop_id, approve);
                                after(() => drops.setData((list = []) => list.filter((x) => x.drop_id !== d.drop_id)));
                                return approve ? "The shift is now unassigned — fill it from the schedule." : undefined;
                            }}
                        >
                            <ShiftBox label="Shift" shift={d.shift} />
                        </RequestCard>
                    ))}
                />
            )}

            {tab === "timeoff" && (
                <RequestList
                    loading={timeOff.loading}
                    error={timeOff.error?.message}
                    onRetry={timeOff.refetch}
                    empty="No time-off requests"
                    emptyHint="Requests from across your company appear here."
                    items={(timeOff.data ?? []).map((r) => (
                        <TimeOffCard
                            key={r.request_id}
                            request={r}
                            name={nameOf(r.user_id, r.employee?.name)}
                            canApprove={canApprove}
                            onDone={() =>
                                after(() => timeOff.setData((list = []) => list.filter((x) => x.request_id !== r.request_id)))
                            }
                        />
                    ))}
                />
            )}
        </div>
    );
}

function RequestList({
    loading,
    error,
    onRetry,
    items,
    empty,
    emptyHint,
}: {
    loading: boolean;
    error?: string;
    onRetry: () => void;
    items: React.ReactNode[];
    empty: string;
    emptyHint: string;
}) {
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    if (loading)
        return (
            <div className="space-y-3">
                <Skeleton className="h-36" />
                <Skeleton className="h-36" />
            </div>
        );
    if (!items.length)
        return (
            <Card>
                <EmptyState icon={Inbox} title={empty} description={emptyHint} />
            </Card>
        );
    return <div className="space-y-3">{items}</div>;
}

function ShiftBox({ label, shift }: { label: string; shift: RequestShift | null }) {
    const { timezone: tz } = useManager();
    if (!shift?.start_time || !shift.end_time) {
        return <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Shift no longer exists.</div>;
    }
    return (
        <div className="rounded-md bg-muted/60 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-sm font-medium text-foreground">{formatDate(shift.start_time, { weekday: "long" }, tz)}</p>
            <p className="text-sm text-muted-foreground">
                {formatTimeRange(shift.start_time, shift.end_time, tz)}
                {shift.role ? ` · ${shift.role}` : ""}
            </p>
        </div>
    );
}

function RequestCard({
    name,
    created,
    title,
    reason,
    canApprove,
    conflicts,
    approveHint,
    onDecide,
    children,
}: {
    name: string;
    created: string;
    title: string;
    reason: string | null;
    canApprove: boolean;
    conflicts?: ShiftConflict[];
    approveHint?: string;
    /** Resolves to an optional follow-up message shown after the decision. */
    onDecide: (approve: boolean) => Promise<string | undefined>;
    children: React.ReactNode;
}) {
    const { timezone: tz } = useManager();
    const toast = useToast();
    const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

    async function decide(approve: boolean) {
        setBusy(approve ? "approve" : "reject");
        try {
            const note = await onDecide(approve);
            toast.success(approve ? "Approved" : "Rejected", note ?? `${name} has been notified.`);
        } catch (err) {
            toast.error("Couldn't record the decision", err instanceof Error ? err.message : undefined);
            setBusy(null);
        }
    }

    return (
        <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-3">
                <Avatar name={name} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                        {name} <span className="font-normal text-muted-foreground">· {title}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Requested {formatRelative(created)}</p>
                </div>
            </div>

            <div className="mt-4 space-y-3">
                {children}
                {reason && (
                    <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">&ldquo;{reason}&rdquo;</blockquote>
                )}
                {!!conflicts?.length && (
                    <div role="alert" className="flex gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                        <div>
                            <p className="font-medium text-foreground">Approving creates an overlap</p>
                            <ul className="text-xs text-muted-foreground">
                                {conflicts.map((c) => (
                                    <li key={c.shift_id}>
                                        Clashes with {formatDate(c.start_time, {}, tz)} {formatTimeRange(c.start_time, c.end_time, tz)}
                                        {c.role ? ` (${c.role})` : ""}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>

            {canApprove && (
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                    {approveHint && <p className="mr-auto text-xs text-muted-foreground">{approveHint}</p>}
                    <Button variant="outline" onClick={() => decide(false)} disabled={!!busy}>
                        <X /> {busy === "reject" ? "Rejecting…" : "Reject"}
                    </Button>
                    <Button onClick={() => decide(true)} disabled={!!busy}>
                        <Check /> {busy === "approve" ? "Approving…" : "Approve"}
                    </Button>
                </div>
            )}
        </Card>
    );
}

function TimeOffCard({
    request: r,
    name,
    canApprove,
    onDone,
}: {
    request: TimeOffRequest;
    name: string;
    canApprove: boolean;
    onDone: () => void;
}) {
    const toast = useToast();
    const [deciding, setDeciding] = useState<boolean | null>(null); // approve? null = closed
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);

    async function submit() {
        if (deciding === null) return;
        setBusy(true);
        try {
            await decideTimeOff(r.request_id, deciding, notes.trim());
            toast.success(deciding ? "Time off approved" : "Time off rejected", `${name} has been notified.`);
            setDeciding(null);
            onDone();
        } catch (err) {
            toast.error("Couldn't record the decision", err instanceof Error ? err.message : undefined);
        } finally {
            setBusy(false);
        }
    }

    const sameDay = r.start_date === r.end_date;

    return (
        <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-3">
                <Avatar name={name} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                        {name} <span className="font-normal text-muted-foreground">· {titleCase(r.request_type)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">Requested {formatRelative(r.created_at)}</p>
                </div>
                <Badge tone="info">
                    {r.days} day{r.days === 1 ? "" : "s"}
                </Badge>
            </div>
            <div className="mt-4 space-y-3">
                <div className="rounded-md bg-muted/60 p-3 text-sm font-medium text-foreground">
                    {sameDay
                        ? formatDate(r.start_date, { weekday: "long", year: "numeric" })
                        : `${formatDate(r.start_date)} – ${formatDate(r.end_date, { year: "numeric" })}`}
                </div>
                {r.reason && (
                    <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">&ldquo;{r.reason}&rdquo;</blockquote>
                )}
            </div>
            {canApprove && (
                <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
                    <Button variant="outline" onClick={() => setDeciding(false)}>
                        <X /> Reject
                    </Button>
                    <Button onClick={() => setDeciding(true)}>
                        <Check /> Approve
                    </Button>
                </div>
            )}

            <Dialog
                open={deciding !== null}
                onOpenChange={(o) => !o && !busy && setDeciding(null)}
                title={deciding ? `Approve ${name}'s time off?` : `Reject ${name}'s time off?`}
                description={
                    deciding
                        ? "They won't be scheduled on these dates when you build the week."
                        : "Let them know why, so they can plan around it."
                }
                size="sm"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setDeciding(null)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button variant={deciding ? "default" : "destructive"} onClick={submit} disabled={busy}>
                            {busy ? "Saving…" : deciding ? "Approve" : "Reject"}
                        </Button>
                    </>
                }
            >
                <Field label="Note to employee (optional)" htmlFor={`notes-${r.request_id}`}>
                    <Textarea
                        id={`notes-${r.request_id}`}
                        value={notes}
                        maxLength={500}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </Field>
            </Dialog>
        </Card>
    );
}
