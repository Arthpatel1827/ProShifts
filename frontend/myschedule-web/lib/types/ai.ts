// Shapes returned by the backend's /ai/* endpoints. Every number here is computed by the
// backend; only `reply`, `summary`, `reason` and `recommendations` are written by the model.

export type AIStatus = { configured: boolean; provider: string; model: string; plan: string };

export type ToolUse = { name: string; arguments: Record<string, unknown>; ok: boolean };

export type AssistantTurn = { role: "user" | "assistant"; content: string };

export type AssistantReply = { reply: string; tools_used: ToolUse[]; model: string };

export type StaffingRequirement = {
    days: string[];
    start_time: string;
    end_time: string;
    role_id: number | null;
    headcount: number;
};

export type Recommendation = {
    index: number;
    valid: boolean;
    user_id: number;
    employee_name: string | null;
    date: string;
    start_time: string;
    end_time: string;
    overnight: boolean;
    role_id: number | null;
    role_name: string | null;
    existing_shift_id: number | null;
    break_minutes: number;
    reason: string;
    paid_hours: number;
    estimated_cost: number;
    week_hours_after: number | null;
    failures: string[];
    warnings: string[];
};

export type CopilotResult = {
    week_start: string;
    timezone: string;
    summary: string;
    recommendations: Recommendation[];
    metrics: {
        proposed: number;
        valid: number;
        rejected: number;
        coverage: { basis: "staffing requirements" | "open shifts" | "none"; covered: number | null; required: number | null; pct: number | null };
        current_labor_cost: number;
        projected_labor_cost: number;
        added_hours: number;
        labor_budget: number | null;
        budget_variance: number | null;
        overtime_employees: number;
    };
    rules_checked: string[];
    model: string;
};

export type ApplyResult = {
    applied: boolean;
    created_shift_ids?: number[];
    assigned_existing_shift_ids?: number[];
    failed?: { index: number; error: string }[];
    message?: string;
};

export type InsightIssue = { type: string; severity: "high" | "medium" | "low"; text: string };

export type HoursRow = {
    user_id: number;
    name: string;
    role: string | null;
    scheduled_hours: number;
    max_hours_week: number | null;
    unused_availability_hours: number | null;
    status: string;
};

export type InsightFacts = {
    week_start: string;
    timezone: string;
    labor: { projected_cost: number; scheduled_hours: number; previous_week_cost: number; budget: number | null; variance: number | null; method: string };
    issues: InsightIssue[];
    open_shifts: { shift_id: number; date: string; weekday: string; start: string; end: string; role: string | null }[];
    overtime: HoursRow[];
    approaching_overtime: HoursRow[];
    underused_availability: HoursRow[];
    conflicts: { type: string; name: string; detail: string }[];
    days: { date: string; weekday: string; hours: number; cost: number; history_avg_hours: number | null }[];
    history_weeks: number;
    savings_opportunities: { date: string; weekday: string; hours_above_average: number; cost_of_those_hours: number }[];
    overtime_threshold_hours: number;
};

export type Insights = {
    facts: InsightFacts;
    ai: null | { status: "ok"; recommendations: string[]; model: string } | { status: "error"; code: string; error: string };
};
