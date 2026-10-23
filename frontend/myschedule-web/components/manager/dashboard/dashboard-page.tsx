"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
    AlertTriangle,
    ArrowRight,
    CalendarClock,
    CalendarX2,
    Clock,
    FileClock,
    Inbox,
    UserX,
    Users,
} from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, Stat } from "@/components/ui/primitives";
import { getLaborCost, listShifts, rolesWithStaff } from "@/lib/api/shifts";
import { getTeamStatus } from "@/lib/api/team";
import { useQuery } from "@/lib/hooks/use-query";
import { useLiveRefresh } from "@/lib/hooks/use-socket";
import {
    addDays,
    formatDate,
    formatHours,
    formatMoney,
    formatTime,
    formatTimeRange,
    getMonday,
    isSameDay,
    shiftHours,
    toDateKey,
} from "@/lib/format";
import { teamStatusTone } from "@/lib/theme/tokens";
import type { Shift } from "@/lib/types";

const TEAM_REFRESH_MS = 60_000;

export default function DashboardPage() {
    const { location, user, pending } = useManager();
    const locationId = location?.id ?? null;
    const now = new Date();
    const weekStart = getMonday(now);
    const weekKey = toDateKey(weekStart);

    const team = useQuery(locationId ? ["team-status", locationId] : null, () => getTeamStatus(locationId!), {
        refreshMs: TEAM_REFRESH_MS,
    });
    const shifts = useQuery(locationId ? ["shifts", locationId, weekKey] : null, () =>
        listShifts(locationId!, weekKey)
    );
    const labor = useQuery(locationId ? ["labor", locationId, weekKey] : null, () =>
        getLaborCost(locationId!, weekKey)
    );
    const roles = useQuery(locationId ? ["roles", locationId] : null, () => rolesWithStaff(locationId!));

    useLiveRefresh(locationId, ["shift:updated", "schedule:published"], () => {
        void shifts.refetch();
        void labor.refetch();
        void team.refetch();
    });

    const names = useMemo(() => {
        const map = new Map<number, string>();
        roles.data?.forEach((r) => r.employees.forEach((e) => map.set(e.user_id, e.name)));
        return map;
    }, [roles.data]);

    const live = (shifts.data ?? []).filter((s) => s.status !== "cancelled");
    const today = live.filter((s) => isSameDay(new Date(s.start_time), now));
    const inProgress = today.filter((s) => new Date(s.start_time) <= now && now < new Date(s.end_time));
    const upcoming = live
        .filter((s) => new Date(s.start_time) > now && !isSameDay(new Date(s.start_time), now))
        .slice(0, 6);
    const unassigned = live.filter((s) => s.assignments.length === 0 && new Date(s.end_time) > now);
    const drafts = live.filter((s) => s.status === "draft");
    const teamList = team.data ?? [];
    const lateStaff = teamList.filter((m) => m.status === "late");
    const onShift = teamList.filter((m) => m.status === "working" || m.status === "on_break").length;

    const greetingName = user?.display_name?.split(" ")[0] || user?.username || "";
    const hour = now.getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">
                    {greeting}
                    {greetingName ? `, ${greetingName}` : ""}
                </h2>
                <p className="text-sm text-muted-foreground">
                    {formatDate(now, { weekday: "long", month: "long", year: "numeric" })} · {location?.name}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                    label="On shift now"
                    value={`${onShift}/${teamList.length}`}
                    hint={lateStaff.length ? `${lateStaff.length} running late` : "Scheduled today"}
                    tone={lateStaff.length ? "danger" : undefined}
                    loading={team.loading}
                />
                <Stat
                    label="Scheduled this week"
                    value={labor.data ? formatHours(labor.data.total_hours) : "—"}
                    hint={labor.data ? `${labor.data.total_shifts} shifts` : undefined}
                    loading={labor.loading}
                />
                <Stat
                    label="Est. labor cost"
                    value={labor.data ? formatMoney(labor.data.total_cost) : "—"}
                    hint="Draft and published shifts"
                    loading={labor.loading}
                />
                <Stat
                    label="Pending approvals"
                    value={pending?.total ?? "—"}
                    hint={pending ? `${pending.swaps} swaps · ${pending.drops} drops · ${pending.timeOff} time off` : undefined}
                    tone={pending?.total ? "primary" : undefined}
                    loading={!pending}
                />
            </div>

            <Alerts
                late={lateStaff.length}
                unassigned={unassigned.length}
                drafts={drafts.length}
                pending={pending?.total ?? 0}
            />

            <div className="grid gap-6 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                    <CardHeader
                        title="Today's team"
                        description="Live clock status for everyone scheduled today"
                        action={<RefreshHint fetching={team.fetching} />}
                    />
                    {team.error ? (
                        <div className="px-5 pb-5">
                            <ErrorState message={team.error.message} onRetry={team.refetch} />
                        </div>
                    ) : team.loading ? (
                        <ListSkeleton />
                    ) : teamList.length === 0 ? (
                        <EmptyState icon={Users} title="No one is scheduled today" description="Published shifts for today will appear here." />
                    ) : (
                        <ul className="divide-y divide-border">
                            {teamList.map((m) => {
                                const s = teamStatusTone[m.status];
                                return (
                                    <li key={m.user_id} className="flex items-center gap-3 px-5 py-3">
                                        <Avatar name={m.name} initials={m.initials} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                                            <p className="truncate text-xs text-muted-foreground">
                                                {m.role}
                                                {m.shift_start && m.shift_end && ` · ${formatTimeRange(m.shift_start, m.shift_end)}`}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <Badge tone={s.tone}>{s.label}</Badge>
                                            {m.clocked_in && (
                                                <p className="mt-1 text-[11px] text-muted-foreground">In at {formatTime(m.clocked_in)}</p>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Card>

                <Card>
                    <CardHeader title="Shape of the week" description="Scheduled paid hours per day" />
                    {shifts.loading ? (
                        <div className="px-5 pb-5">
                            <Skeleton className="h-40" />
                        </div>
                    ) : (
                        <WeekShape weekStart={weekStart} shifts={live} />
                    )}
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <ShiftList
                    title="Today's schedule"
                    description={inProgress.length ? `${inProgress.length} in progress` : "Nothing in progress right now"}
                    shifts={today}
                    names={names}
                    now={now}
                    loading={shifts.loading}
                    error={shifts.error?.message}
                    empty="No shifts today."
                    showDate={false}
                />
                <ShiftList
                    title="Coming up this week"
                    shifts={upcoming}
                    names={names}
                    now={now}
                    loading={shifts.loading}
                    error={shifts.error?.message}
                    empty="No more shifts scheduled this week."
                    showDate
                />
            </div>
        </div>
    );
}

function RefreshHint({ fetching }: { fetching: boolean }) {
    return (
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
            {fetching ? "Updating…" : "Auto-refreshes"}
        </span>
    );
}

function ListSkeleton() {
    return (
        <div className="space-y-3 px-5 pb-5">
            {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
            ))}
        </div>
    );
}

function Alerts({ late, unassigned, drafts, pending }: { late: number; unassigned: number; drafts: number; pending: number }) {
    const items = [
        late > 0 && {
            icon: Clock,
            tone: "danger" as const,
            text: `${late} ${late === 1 ? "person hasn't" : "people haven't"} clocked in for their shift`,
            href: undefined,
        },
        unassigned > 0 && {
            icon: UserX,
            tone: "danger" as const,
            text: `${unassigned} upcoming shift${unassigned === 1 ? " has" : "s have"} no one assigned`,
            href: "/manager/schedule",
        },
        drafts > 0 && {
            icon: FileClock,
            tone: "warning" as const,
            text: `${drafts} draft shift${drafts === 1 ? "" : "s"} this week ${drafts === 1 ? "isn't" : "aren't"} published yet`,
            href: "/manager/schedule",
        },
        pending > 0 && {
            icon: Inbox,
            tone: "primary" as const,
            text: `${pending} request${pending === 1 ? "" : "s"} waiting for your approval`,
            href: "/manager/requests",
        },
    ].filter(Boolean) as { icon: typeof Clock; tone: "danger" | "warning" | "primary"; text: string; href?: string }[];

    if (!items.length) return null;

    const toneClass = {
        danger: "text-destructive",
        warning: "text-warning",
        primary: "text-primary",
    };

    return (
        <Card>
            <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" />Needs attention</span>} />
            <ul className="divide-y divide-border border-t border-border">
                {items.map((item) => {
                    const Icon = item.icon;
                    const body = (
                        <>
                            <Icon className={`size-4 shrink-0 ${toneClass[item.tone]}`} />
                            <span className="flex-1 text-sm text-foreground">{item.text}</span>
                            {item.href && <ArrowRight className="size-4 text-muted-foreground" />}
                        </>
                    );
                    return (
                        <li key={item.text}>
                            {item.href ? (
                                <Link href={item.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                                    {body}
                                </Link>
                            ) : (
                                <div className="flex items-center gap-3 px-5 py-3">{body}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
}

function WeekShape({ weekStart, shifts }: { weekStart: Date; shifts: Shift[] }) {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
        const day = addDays(weekStart, i);
        const dayShifts = shifts.filter((s) => isSameDay(new Date(s.start_time), day));
        const hours = dayShifts.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time, s.break_minutes), 0);
        const open = dayShifts.filter((s) => s.assignments.length === 0).length;
        return { day, hours, count: dayShifts.length, open };
    });
    const max = Math.max(...days.map((d) => d.hours), 1);

    if (days.every((d) => d.count === 0)) {
        return <EmptyState icon={CalendarX2} title="Nothing scheduled this week" action={<Link href="/manager/schedule" className="text-sm font-medium text-primary hover:underline">Build the schedule</Link>} />;
    }

    return (
        <div className="px-5 pb-5">
            <div className="flex items-end gap-2" role="img" aria-label="Scheduled hours per day this week">
                {days.map((d) => {
                    const isToday = isSameDay(d.day, today);
                    return (
                        <div key={d.day.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
                            <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                                {d.hours ? formatHours(Math.round(d.hours)) : ""}
                            </span>
                            {/* Fixed-height track: % heights collapse to 0 inside an auto-height flex child. */}
                            <div className="flex h-28 w-full items-end">
                                <div
                                    className={`w-full rounded-t-md ${isToday ? "bg-primary" : "bg-primary/35"}`}
                                    style={{ height: `${Math.max((d.hours / max) * 100, d.count ? 4 : 0)}%` }}
                                    title={`${d.count} shifts, ${d.hours.toFixed(1)}h${d.open ? `, ${d.open} unassigned` : ""}`}
                                />
                            </div>
                            <span className={`text-[11px] ${isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                                {d.day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ShiftList({
    title,
    description,
    shifts,
    names,
    now,
    loading,
    error,
    empty,
    showDate,
}: {
    title: string;
    description?: string;
    shifts: Shift[];
    names: Map<number, string>;
    now: Date;
    loading: boolean;
    error?: string;
    empty: string;
    showDate: boolean;
}) {
    return (
        <Card>
            <CardHeader
                title={title}
                description={description}
                action={
                    <Link href="/manager/schedule" className="text-xs font-medium text-primary hover:underline">
                        Open schedule
                    </Link>
                }
            />
            {error ? (
                <div className="px-5 pb-5">
                    <ErrorState message={error} />
                </div>
            ) : loading ? (
                <ListSkeleton />
            ) : shifts.length === 0 ? (
                <EmptyState icon={CalendarClock} title={empty} />
            ) : (
                <ul className="divide-y divide-border">
                    {shifts.map((s) => {
                        const running = new Date(s.start_time) <= now && now < new Date(s.end_time);
                        const done = new Date(s.end_time) <= now;
                        const who = s.assignments.map((a) => names.get(a.user_id) ?? `#${a.user_id}`).join(", ");
                        return (
                            <li key={s.shift_id} className={`flex items-center gap-3 px-5 py-3 ${done ? "opacity-60" : ""}`}>
                                <div className="w-24 shrink-0 text-xs">
                                    {showDate && <p className="font-medium text-foreground">{formatDate(s.start_time)}</p>}
                                    <p className="text-muted-foreground">{formatTime(s.start_time)}</p>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-foreground">{s.role ?? "Any role"}</p>
                                    <p className={`truncate text-xs ${who ? "text-muted-foreground" : "text-destructive"}`}>
                                        {who || "Unassigned"}
                                    </p>
                                </div>
                                {running ? (
                                    <Badge tone="success">In progress</Badge>
                                ) : s.status === "draft" ? (
                                    <Badge tone="warning">Draft</Badge>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
}
