"use client";

import { useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, Stat } from "@/components/ui/primitives";
import { getAnalytics } from "@/lib/api/analytics";
import { useQuery } from "@/lib/hooks/use-query";
import { addDaysToKey, formatHours, formatMoney, todayKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Analytics, AnalyticsPeriod } from "@/lib/types";

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
];

/** Moves a "YYYY-MM-DD" anchor by one period. */
function shiftAnchor(anchor: string, period: AnalyticsPeriod, dir: -1 | 1): string {
    if (period === "day") return addDaysToKey(anchor, dir);
    if (period === "week") return addDaysToKey(anchor, 7 * dir);
    const [y, m] = anchor.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    return d.toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
    const { location, timezone: tz } = useManager();
    const locationId = location?.id ?? null;
    const [period, setPeriod] = useState<AnalyticsPeriod>("week");
    // Anchored on the location's today; null = follow the current period.
    const [picked, setPicked] = useState<string | null>(null);
    const today = todayKey(tz);
    const anchorKey = picked ?? today;

    const q = useQuery(locationId ? ["analytics", locationId, period, anchorKey] : null, () =>
        getAnalytics(locationId!, period, anchorKey)
    );
    const a = q.data;
    const isCurrent = shiftAnchor(anchorKey, period, 1) > today;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPicked(shiftAnchor(anchorKey, period, -1))}
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent"
                        aria-label={`Previous ${period}`}
                    >
                        <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-44 text-center text-sm font-medium text-foreground">
                        {a?.date_label ?? "…"}
                    </span>
                    <button
                        onClick={() => setPicked(shiftAnchor(anchorKey, period, 1))}
                        disabled={isCurrent}
                        className="rounded-md p-2 text-muted-foreground hover:bg-accent disabled:opacity-40"
                        aria-label={`Next ${period}`}
                    >
                        <ChevronRight className="size-4" />
                    </button>
                    {!isCurrent && (
                        <button
                            onClick={() => setPicked(null)}
                            className="ml-1 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent"
                        >
                            Current
                        </button>
                    )}
                </div>

                <div role="tablist" aria-label="Period" className="inline-flex rounded-lg border border-border bg-card p-0.5">
                    {PERIODS.map((p) => (
                        <button
                            key={p.value}
                            role="tab"
                            aria-selected={period === p.value}
                            onClick={() => setPeriod(p.value)}
                            className={cn(
                                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                period === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {q.error && <ErrorState message={q.error.message} onRetry={q.refetch} />}

            <Summary a={a} loading={q.loading} />

            {a && a.summary.total_shifts === 0 && a.summary.worked_hours === 0 ? (
                <Card>
                    <EmptyState
                        icon={BarChart3}
                        title="No activity in this period"
                        description="Analytics use published shifts and completed clock-ins from the mobile app."
                    />
                </Card>
            ) : (
                <>
                    <div className="grid gap-6 xl:grid-cols-3">
                        <Card className="xl:col-span-2">
                            <CardHeader
                                title={period === "day" ? "Hours by employee" : "Hours worked per day"}
                                description="Completed clock-ins"
                            />
                            <div className="px-5 pb-5">
                                {q.loading ? (
                                    <Skeleton className="h-48" />
                                ) : period === "day" ? (
                                    <HBars rows={(a?.hours_per_employee ?? []).map((e) => ({ label: e.name, sub: e.role, value: e.hours }))} />
                                ) : (
                                    <VBars rows={(a?.hours_per_day ?? []).map((d) => ({ label: period === "week" ? d.day : d.dayNum, value: d.worked }))} dense={period === "month"} />
                                )}
                            </div>
                        </Card>

                        <Card>
                            <CardHeader title="Hours by role" />
                            <div className="px-5 pb-5">
                                {q.loading ? (
                                    <Skeleton className="h-48" />
                                ) : (
                                    <HBars rows={(a?.hours_by_role ?? []).map((r) => ({ label: r.role, sub: `${r.pct}%`, value: r.hours }))} />
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                            <CardHeader
                                title={period === "month" ? "Last 4 months" : "Last 4 weeks"}
                                description="Hours worked and labor cost"
                            />
                            <div className="px-5 pb-5">
                                {q.loading ? <Skeleton className="h-40" /> : <Trend rows={a?.trend_data ?? []} />}
                            </div>
                        </Card>

                        <Card>
                            <CardHeader title="Late clock-ins" description="More than 5 minutes after shift start" />
                            {q.loading ? (
                                <div className="px-5 pb-5">
                                    <Skeleton className="h-40" />
                                </div>
                            ) : !a?.late_list.length ? (
                                <EmptyState icon={Clock} title="Everyone was on time" />
                            ) : (
                                <ul className="divide-y divide-border border-t border-border">
                                    {a.late_list.map((l, i) => (
                                        <li key={`${l.name}-${l.date}-${i}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                                            <span className="font-medium text-foreground">{l.name}</span>
                                            <span className="flex items-center gap-3 text-muted-foreground">
                                                {l.date}
                                                <Badge tone={l.mins_late > 15 ? "danger" : "warning"}>{l.mins_late} min</Badge>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                    </div>
                </>
            )}
        </div>
    );
}

function Summary({ a, loading }: { a?: Analytics; loading: boolean }) {
    const s = a?.summary;
    const variance = s ? Math.round((s.worked_hours - s.scheduled_hours) * 10) / 10 : 0;
    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Scheduled hours" value={s ? formatHours(s.scheduled_hours) : "—"} hint={s ? `${s.total_shifts} published shifts` : undefined} loading={loading} />
            <Stat label="Worked hours" value={s ? formatHours(s.worked_hours) : "—"} hint={s ? `${s.total_staff} active staff` : undefined} loading={loading} />
            <Stat
                label="Variance"
                value={s ? `${variance > 0 ? "+" : ""}${formatHours(variance)}` : "—"}
                hint="Worked vs scheduled"
                tone={s && Math.abs(variance) > s.scheduled_hours * 0.1 ? "danger" : undefined}
                loading={loading}
            />
            <Stat label="Labor cost" value={s ? formatMoney(s.labor_cost) : "—"} hint="Actual, from hourly rates" loading={loading} />
            <Stat label="Coverage" value={s ? `${s.coverage_pct}%` : "—"} hint="Worked ÷ scheduled" loading={loading} />
            <Stat
                label="Late / overtime"
                value={s ? `${s.late_clockins} · ${formatHours(s.overtime_hours)}` : "—"}
                hint="Late clock-ins · OT hours"
                tone={s?.late_clockins ? "danger" : undefined}
                loading={loading}
            />
        </div>
    );
}

function VBars({ rows, dense }: { rows: { label: string; value: number }[]; dense?: boolean }) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return (
        <div className={cn("flex items-end", dense ? "gap-0.5" : "gap-2")} role="img" aria-label="Hours worked per day">
            {rows.map((r, i) => (
                <div key={`${r.label}-${i}`} className="flex flex-1 flex-col items-center gap-1" title={`${r.label}: ${r.value}h`}>
                    {!dense && <span className="text-[10px] tabular-nums text-muted-foreground">{r.value ? formatHours(r.value) : ""}</span>}
                    {/* Fixed-height track: % heights collapse to 0 inside an auto-height flex child. */}
                    <div className="flex h-36 w-full items-end">
                        <div className="w-full rounded-t-sm bg-chart-1" style={{ height: `${(r.value / max) * 100}%` }} />
                    </div>
                    <span className={cn("text-muted-foreground", dense ? "text-[8px]" : "text-[11px]")}>{dense && i % 3 ? "" : r.label}</span>
                </div>
            ))}
        </div>
    );
}

function HBars({ rows }: { rows: { label: string; sub?: string; value: number }[] }) {
    if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No hours recorded.</p>;
    const max = Math.max(...rows.map((r) => r.value), 1);
    return (
        <ul className="space-y-3">
            {rows.map((r) => (
                <li key={r.label}>
                    <div className="mb-1 flex justify-between text-xs">
                        <span className="font-medium text-foreground">{r.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                            {formatHours(r.value)}
                            {r.sub ? ` · ${r.sub}` : ""}
                        </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(r.value / max) * 100}%` }} />
                    </div>
                </li>
            ))}
        </ul>
    );
}

function Trend({ rows }: { rows: { label: string; hours: number; cost: number }[] }) {
    if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No history yet.</p>;
    const maxH = Math.max(...rows.map((r) => r.hours), 1);
    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Period</th>
                    <th className="pb-2 font-medium">Hours</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr key={r.label}>
                        <td className="w-20 py-1.5 text-muted-foreground">{r.label}</td>
                        <td className="py-1.5 pr-4">
                            <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 rounded-full bg-muted">
                                    <div className="h-2 rounded-full bg-chart-1" style={{ width: `${(r.hours / maxH) * 100}%` }} />
                                </div>
                                <span className="w-12 text-right text-xs tabular-nums">{formatHours(r.hours)}</span>
                            </div>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatMoney(r.cost)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
