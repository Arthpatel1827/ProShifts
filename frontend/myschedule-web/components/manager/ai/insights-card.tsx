"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { aiErrorMessage, getInsights } from "@/lib/api/ai";
import { useQuery } from "@/lib/hooks/use-query";
import { formatHours, formatKey, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InsightFacts, InsightIssue, Insights } from "@/lib/types";
import { AIMark, Kind, wallTime } from "./ai-common";

const SEVERITY_DOT: Record<InsightIssue["severity"], string> = {
    high: "bg-destructive",
    medium: "bg-warning",
    low: "bg-muted-foreground/50",
};

/** Dashboard card. Facts only (no AI call), so it loads fast and works without AI configured. */
export function InsightsCard({ locationId, weekStart }: { locationId: number; weekStart: string }) {
    const [open, setOpen] = useState(false);
    const q = useQuery(["ai-insights", locationId, weekStart], () => getInsights(locationId, weekStart));
    const f = q.data?.facts;
    const issues = f?.issues ?? [];

    return (
        <Card>
            <CardHeader
                title={
                    <span className="flex items-center gap-2">
                        <AIMark /> AI Workforce Insights
                    </span>
                }
                description="This week, from your schedule, hours and availability"
                action={
                    f && (
                        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                            View insights <ArrowRight />
                        </Button>
                    )
                }
            />
            {q.error ? (
                <div className="px-5 pb-5">
                    <ErrorState message={q.error.message} onRetry={q.refetch} />
                </div>
            ) : q.loading || !f ? (
                <div className="space-y-2 px-5 pb-5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4" />
                    <Skeleton className="h-4" />
                </div>
            ) : issues.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No staffing issues detected" description={`Projected labor ${formatMoney(f.labor.projected_cost)} for ${formatHours(f.labor.scheduled_hours)} scheduled.`} />
            ) : (
                <div className="px-5 pb-5">
                    <p className="text-sm font-medium text-foreground">
                        {issues.length} issue{issues.length === 1 ? "" : "s"} detected
                    </p>
                    <ul className="mt-2 space-y-1.5">
                        {issues.slice(0, 4).map((i) => (
                            <li key={i.type + i.text} className="flex items-center gap-2 text-sm text-foreground">
                                <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[i.severity])} aria-hidden />
                                {i.text}
                            </li>
                        ))}
                    </ul>
                    {issues.length > 4 && <p className="mt-1.5 text-xs text-muted-foreground">+{issues.length - 4} more</p>}
                </div>
            )}
            <InsightsDialog open={open} onOpenChange={setOpen} locationId={locationId} weekStart={weekStart} initial={q.data} />
        </Card>
    );
}

function InsightsDialog({
    open,
    onOpenChange,
    locationId,
    weekStart,
    initial,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    locationId: number;
    weekStart: string;
    initial?: Insights;
}) {
    const [budget, setBudget] = useState("");
    const [data, setData] = useState<Insights | undefined>(initial);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const f = (data ?? initial)?.facts;
    const ai = data?.ai;

    async function run(withAi: boolean) {
        const b = budget.trim() ? Number(budget) : null;
        if (b !== null && (!Number.isFinite(b) || b <= 0)) {
            setError("Budget must be a positive number.");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setData(await getInsights(locationId, weekStart, { ai: withAi, budget: b }));
        } catch (err) {
            setError(aiErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            title="Weekly labor & staffing insights"
            description={`Week of ${formatKey(weekStart, { month: "long", day: "numeric" })}. Facts are calculated by ProShifts; suggestions come from AI.`}
        >
            {!f ? (
                <Skeleton className="h-40" />
            ) : (
                <div className="space-y-5">
                    {error && <ErrorState message={error} />}
                    <Facts f={f} />

                    <form
                        className="flex items-end gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(Boolean(ai));
                        }}
                    >
                        <Field label="Compare against a labor budget" htmlFor="insights-budget" className="flex-1">
                            <Input id="insights-budget" inputMode="decimal" placeholder="e.g. 8000" value={budget} onChange={(e) => setBudget(e.target.value)} />
                        </Field>
                        <Button type="submit" variant="outline" size="lg" disabled={loading}>
                            Apply
                        </Button>
                    </form>

                    <section className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                <AIMark /> AI recommendations
                            </h3>
                            <Button size="sm" onClick={() => void run(true)} disabled={loading}>
                                {loading ? <Loader2 className="animate-spin" /> : ai ? <RefreshCw /> : <AIMark className="text-primary-foreground" />}
                                {ai ? "Regenerate" : "Get recommendations"}
                            </Button>
                        </div>
                        {!ai ? (
                            <p className="mt-2 text-xs text-muted-foreground">Nemotron reviews the facts above and suggests changes. Nothing is changed automatically.</p>
                        ) : ai.status === "error" ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                                {ai.code === "AI_NOT_CONFIGURED" ? "AI isn't set up on this server yet." : ai.error} The facts above are still accurate.
                            </p>
                        ) : (
                            <ul className="mt-3 space-y-2">
                                {ai.recommendations.map((r) => (
                                    <li key={r} className="flex items-start gap-2 text-sm text-foreground">
                                        <Kind kind="recommendation" /> <span>{r}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            )}
        </Dialog>
    );
}

function Facts({ f }: { f: InsightFacts }) {
    const v = f.labor.variance;
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Projected labor" value={formatMoney(f.labor.projected_cost)} />
                <Tile label="Budget" value={f.labor.budget ? formatMoney(f.labor.budget) : "—"} />
                <Tile label="Variance" value={v === null ? "—" : `${v > 0 ? "+" : "−"}${formatMoney(Math.abs(v))}`} danger={v !== null && v > 0} />
                <Tile label="Last week" value={formatMoney(f.labor.previous_week_cost)} />
            </div>
            <p className="text-[11px] text-muted-foreground">{f.labor.method}</p>

            <ul className="space-y-2">
                {f.open_shifts.length > 0 && (
                    <FactRow>
                        {f.open_shifts.length} open shift{f.open_shifts.length === 1 ? "" : "s"}:{" "}
                        {f.open_shifts.slice(0, 4).map((s) => `${s.weekday.slice(0, 3)} ${wallTime(s.start)}–${wallTime(s.end)}${s.role ? ` (${s.role})` : ""}`).join(", ")}
                        {f.open_shifts.length > 4 ? "…" : ""}
                    </FactRow>
                )}
                {[...f.overtime, ...f.approaching_overtime].map((e) => (
                    <FactRow key={`ot-${e.user_id}`}>
                        {e.name}: {formatHours(e.scheduled_hours)} scheduled
                        {e.max_hours_week ? ` (max ${e.max_hours_week} h)` : ""} — {e.status.replace(/_/g, " ")} (threshold {f.overtime_threshold_hours} h)
                    </FactRow>
                ))}
                {f.underused_availability.slice(0, 4).map((e) => (
                    <FactRow key={`ua-${e.user_id}`}>
                        {e.name} has {formatHours(e.unused_availability_hours ?? 0)} of availability not scheduled
                    </FactRow>
                ))}
                {f.conflicts.slice(0, 5).map((c, i) => (
                    <FactRow key={`c-${i}`}>
                        Conflict: {c.detail}
                    </FactRow>
                ))}
                {f.savings_opportunities.map((s) => (
                    <FactRow key={`s-${s.date}`}>
                        {s.weekday} has {formatHours(s.hours_above_average)} more than its {f.history_weeks}-week average — up to {formatMoney(s.cost_of_those_hours)} if coverage matched the average
                    </FactRow>
                ))}
                {f.issues.length === 0 && <FactRow>No open shifts, overtime or conflicts this week.</FactRow>}
            </ul>
        </div>
    );
}

function Tile({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
    return (
        <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", danger ? "text-destructive" : "text-foreground")}>{value}</p>
        </div>
    );
}

function FactRow({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2 text-sm text-foreground">
            <Kind kind="fact" />
            <span>{children}</span>
        </li>
    );
}
