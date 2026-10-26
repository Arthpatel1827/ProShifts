"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { aiErrorMessage, applySchedule, generateSchedule } from "@/lib/api/ai";
import { addDaysToKey, formatHours, formatKey, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CopilotResult, Recommendation, RoleWithStaff, StaffingRequirement } from "@/lib/types";
import { AIMark, wallTime } from "./ai-common";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

// What the backend actually loads before asking the model (ai/schedule_copilot.py).
const ANALYSIS = [
    "Employee availability",
    "Time-off requests",
    "Existing schedule",
    "Role requirements",
    "Overtime risk",
    "Labor cost",
];

type Phase = "form" | "generating" | "review";

export function ScheduleCopilotDialog({
    open,
    onOpenChange,
    locationId,
    weekStart,
    roles,
    onApplied,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: number;
    weekStart: string;
    roles: RoleWithStaff[];
    onApplied: () => void;
}) {
    const toast = useToast();
    const [phase, setPhase] = useState<Phase>("form");
    const [budget, setBudget] = useState("");
    const [needs, setNeeds] = useState<StaffingRequirement[]>([]);
    const [instructions, setInstructions] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<CopilotResult | null>(null);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [applying, setApplying] = useState(false);
    const [showRejected, setShowRejected] = useState(false);

    const realRoles = roles.filter((r) => r.role_id !== null);

    function reset() {
        setPhase("form");
        setResult(null);
        setError(null);
        setSelected(new Set());
        setShowRejected(false);
    }

    function close(next: boolean) {
        if (!next && (phase === "generating" || applying)) return;
        onOpenChange(next);
        if (!next) reset();
    }

    async function handleGenerate() {
        const laborBudget = budget.trim() ? Number(budget) : null;
        if (laborBudget !== null && (!Number.isFinite(laborBudget) || laborBudget <= 0)) {
            setError("Labor budget must be a positive number.");
            return;
        }
        if (needs.some((n) => !n.days.length)) {
            setError("Pick at least one day for each staffing need.");
            return;
        }
        setError(null);
        setPhase("generating");
        try {
            const res = await generateSchedule({ locationId, weekStart, laborBudget, requirements: needs, instructions });
            setResult(res);
            setSelected(new Set(res.recommendations.filter((r) => r.valid).map((r) => r.index)));
            setPhase("review");
        } catch (err) {
            setError(aiErrorMessage(err));
            setPhase("form");
        }
    }

    async function handleApply() {
        if (!result) return;
        const chosen = result.recommendations.filter((r) => r.valid && selected.has(r.index));
        if (!chosen.length) return;
        setApplying(true);
        setError(null);
        try {
            const res = await applySchedule(locationId, chosen);
            const added = (res.created_shift_ids?.length ?? 0) + (res.assigned_existing_shift_ids?.length ?? 0);
            if (res.failed?.length) {
                toast.error(`Added ${added}; ${res.failed.length} couldn't be saved`, res.failed[0].error);
            } else {
                toast.success(`Added ${added} draft shift${added === 1 ? "" : "s"}`, "Review and edit them on the schedule, then publish when ready.");
            }
            onApplied();
            close(false);
        } catch (err) {
            // A 422 means something changed since generation (e.g. a new shift or approved time off).
            setError(aiErrorMessage(err) + " Nothing was saved — generate again for fresh recommendations.");
        } finally {
            setApplying(false);
        }
    }

    const valid = result?.recommendations.filter((r) => r.valid) ?? [];
    const rejected = result?.recommendations.filter((r) => !r.valid) ?? [];
    const weekLabel = `${formatKey(weekStart, { month: "short", day: "numeric", year: undefined })} – ${formatKey(addDaysToKey(weekStart, 6), { month: "short", day: "numeric" })}`;

    return (
        <Dialog
            open={open}
            onOpenChange={close}
            size="lg"
            title="AI Schedule Copilot"
            description={`Week of ${weekLabel}. Recommendations become draft shifts only after you add them.`}
            footer={
                phase === "review" ? (
                    <>
                        <Button variant="ghost" onClick={reset} disabled={applying}>
                            Start over
                        </Button>
                        <Button onClick={handleApply} disabled={applying || selected.size === 0}>
                            {applying ? <Loader2 className="animate-spin" /> : <Check />}
                            Add {selected.size} as draft{selected.size === 1 ? "" : "s"}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="ghost" onClick={() => close(false)} disabled={phase === "generating"}>
                            Cancel
                        </Button>
                        <Button onClick={handleGenerate} disabled={phase === "generating"}>
                            {phase === "generating" ? <Loader2 className="animate-spin" /> : <AIMark className="text-primary-foreground" />}
                            Generate recommendations
                        </Button>
                    </>
                )
            }
        >
            {phase === "form" && (
                <div className="space-y-4">
                    <FormError message={error} />
                    <Field label="Labor budget for the week (optional)" htmlFor="copilot-budget" hint="Projected cost is compared against it.">
                        <Input id="copilot-budget" inputMode="decimal" placeholder="e.g. 8000" value={budget} onChange={(e) => setBudget(e.target.value)} />
                    </Field>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Staffing needs (optional)</p>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setNeeds((n) => [...n, { days: [...DAYS], start_time: "09:00", end_time: "17:00", role_id: null, headcount: 1 }])}
                            >
                                <Plus /> Add need
                            </Button>
                        </div>
                        {needs.length === 0 && (
                            <p className="text-xs text-muted-foreground">Without needs, the copilot fills open shifts and keeps coverage similar to what&apos;s scheduled.</p>
                        )}
                        {needs.map((need, i) => (
                            <NeedRow
                                key={i}
                                index={i}
                                need={need}
                                roles={realRoles}
                                onChange={(next) => setNeeds((all) => all.map((n, j) => (j === i ? next : n)))}
                                onRemove={() => setNeeds((all) => all.filter((_, j) => j !== i))}
                            />
                        ))}
                    </div>

                    <Field label="Anything else? (optional)" htmlFor="copilot-notes">
                        <Textarea
                            id="copilot-notes"
                            maxLength={1000}
                            placeholder="e.g. Keep Saturday lean; give Bea more hours."
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                        />
                    </Field>
                </div>
            )}

            {phase === "generating" && (
                <div className="py-6" role="status" aria-live="polite">
                    <p className="text-sm font-medium text-foreground">Analyzing workforce…</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Included in the analysis:</p>
                    <ul className="mt-3 space-y-2">
                        {ANALYSIS.map((a) => (
                            <li key={a} className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Check className="size-4 text-success" /> {a}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-5 flex items-center gap-2 text-sm text-foreground">
                        <Loader2 className="size-4 animate-spin text-primary" /> Generating recommendations and checking every shift against your rules…
                    </p>
                </div>
            )}

            {phase === "review" && result && (
                <div className="space-y-5">
                    <FormError message={error} />
                    <div>
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <AIMark /> AI draft ready
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Metric
                                label="Coverage"
                                value={result.metrics.coverage.pct === null ? "—" : `${result.metrics.coverage.pct}%`}
                                hint={
                                    result.metrics.coverage.basis === "none"
                                        ? "No needs or open shifts"
                                        : `${result.metrics.coverage.covered}/${result.metrics.coverage.required} ${result.metrics.coverage.basis}`
                                }
                            />
                            <Metric
                                label="Projected labor"
                                value={formatMoney(result.metrics.projected_labor_cost)}
                                hint={
                                    result.metrics.budget_variance === null
                                        ? `+${formatHours(result.metrics.added_hours)} added`
                                        : `${result.metrics.budget_variance > 0 ? "+" : "−"}${formatMoney(Math.abs(result.metrics.budget_variance))} vs budget`
                                }
                                tone={result.metrics.budget_variance !== null && result.metrics.budget_variance > 0 ? "danger" : undefined}
                            />
                            <Metric label="Overtime employees" value={String(result.metrics.overtime_employees)} tone={result.metrics.overtime_employees ? "danger" : undefined} />
                            <Metric label="Rejected" value={String(result.metrics.rejected)} hint={`of ${result.metrics.proposed} proposed`} tone={result.metrics.rejected ? "danger" : undefined} />
                        </div>
                        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                            <ShieldCheck className="mt-px size-3.5 shrink-0" /> Metrics are calculated by ProShifts, not the AI. Every shift was checked for: {result.rules_checked.join(", ").toLowerCase()}.
                        </p>
                    </div>

                    {result.summary && (
                        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">AI recommendation</p>
                            <p className="mt-1 text-sm text-foreground">{result.summary}</p>
                        </div>
                    )}

                    <section>
                        <div className="mb-2 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground">Passed validation ({valid.length})</h3>
                            {valid.length > 0 && (
                                <button
                                    className="text-xs font-medium text-primary hover:underline"
                                    onClick={() => setSelected(selected.size === valid.length ? new Set() : new Set(valid.map((r) => r.index)))}
                                >
                                    {selected.size === valid.length ? "Select none" : "Select all"}
                                </button>
                            )}
                        </div>
                        {valid.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                                No recommendation passed validation. Adjust the needs or schedule manually.
                            </p>
                        ) : (
                            <ul className="divide-y divide-border rounded-lg border border-border">
                                {valid.map((r) => (
                                    <RecRow
                                        key={r.index}
                                        rec={r}
                                        checked={selected.has(r.index)}
                                        onToggle={() =>
                                            setSelected((s) => {
                                                const next = new Set(s);
                                                if (next.has(r.index)) next.delete(r.index);
                                                else next.add(r.index);
                                                return next;
                                            })
                                        }
                                    />
                                ))}
                            </ul>
                        )}
                    </section>

                    {rejected.length > 0 && (
                        <section>
                            <button
                                onClick={() => setShowRejected((v) => !v)}
                                className="flex w-full items-center justify-between text-sm font-semibold text-foreground"
                                aria-expanded={showRejected}
                            >
                                Rejected by validation ({rejected.length})
                                <ChevronDown className={cn("size-4 transition-transform", showRejected && "rotate-180")} />
                            </button>
                            {showRejected && (
                                <ul className="mt-2 divide-y divide-border rounded-lg border border-destructive/20">
                                    {rejected.map((r) => (
                                        <RecRow key={r.index} rec={r} />
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
                </div>
            )}
        </Dialog>
    );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" }) {
    return (
        <div className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone === "danger" ? "text-destructive" : "text-foreground")}>{value}</p>
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
    );
}

function RecRow({ rec, checked, onToggle }: { rec: Recommendation; checked?: boolean; onToggle?: () => void }) {
    const id = `rec-${rec.index}`;
    return (
        <li className="flex gap-3 px-3.5 py-2.5">
            {onToggle ? (
                <input id={id} type="checkbox" checked={checked} onChange={onToggle} className="mt-1 size-4 accent-primary" />
            ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <label htmlFor={onToggle ? id : undefined} className="min-w-0 flex-1 cursor-pointer">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium text-foreground">{rec.employee_name ?? `Employee #${rec.user_id}`}</span>
                    <span className="text-muted-foreground">
                        {formatKey(rec.date, { weekday: "short", month: "short", day: "numeric", year: undefined })} · {wallTime(rec.start_time)} – {wallTime(rec.end_time)}
                        {rec.overnight ? " (next day)" : ""}
                    </span>
                    {rec.role_name && <Badge>{rec.role_name}</Badge>}
                    {rec.existing_shift_id && <Badge tone="info">Fills open shift</Badge>}
                    {rec.valid && <span className="text-xs tabular-nums text-muted-foreground">{formatHours(rec.paid_hours)} · {formatMoney(rec.estimated_cost)}</span>}
                </div>
                {rec.reason && <p className="mt-0.5 text-xs text-muted-foreground">AI: {rec.reason}</p>}
                {rec.failures.map((f) => (
                    <p key={f} className="mt-0.5 text-xs text-destructive">{f}</p>
                ))}
                {rec.warnings.map((w) => (
                    <p key={w} className="mt-0.5 flex items-start gap-1 text-xs text-warning-foreground dark:text-warning">
                        <AlertTriangle className="mt-px size-3 shrink-0" /> {w}
                    </p>
                ))}
            </label>
        </li>
    );
}

function NeedRow({
    index,
    need,
    roles,
    onChange,
    onRemove,
}: {
    index: number;
    need: StaffingRequirement;
    roles: RoleWithStaff[];
    onChange: (n: StaffingRequirement) => void;
    onRemove: () => void;
}) {
    return (
        <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap gap-1" role="group" aria-label={`Days for need ${index + 1}`}>
                {DAYS.map((d) => {
                    const on = need.days.includes(d);
                    return (
                        <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange({ ...need, days: on ? need.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || need.days.includes(x)) })}
                            className={cn(
                                "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                                on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
                            )}
                        >
                            {DAY_LABEL[d]}
                        </button>
                    );
                })}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr_0.8fr_auto] sm:items-end">
                <Field label="From" htmlFor={`need-${index}-start`}>
                    <Input id={`need-${index}-start`} type="time" value={need.start_time} onChange={(e) => onChange({ ...need, start_time: e.target.value })} />
                </Field>
                <Field label="To" htmlFor={`need-${index}-end`}>
                    <Input id={`need-${index}-end`} type="time" value={need.end_time} onChange={(e) => onChange({ ...need, end_time: e.target.value })} />
                </Field>
                <Field label="Role" htmlFor={`need-${index}-role`}>
                    <Select
                        id={`need-${index}-role`}
                        value={need.role_id ?? ""}
                        onChange={(e) => onChange({ ...need, role_id: e.target.value ? Number(e.target.value) : null })}
                    >
                        <option value="">Any role</option>
                        {roles.map((r) => (
                            <option key={r.role_id!} value={r.role_id!}>
                                {r.role_name}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="People" htmlFor={`need-${index}-count`}>
                    <Input
                        id={`need-${index}-count`}
                        type="number"
                        min={1}
                        max={50}
                        value={need.headcount}
                        onChange={(e) => onChange({ ...need, headcount: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                    />
                </Field>
                <Button variant="ghost" size="icon-lg" onClick={onRemove} aria-label={`Remove need ${index + 1}`}>
                    <Trash2 />
                </Button>
            </div>
        </div>
    );
}
