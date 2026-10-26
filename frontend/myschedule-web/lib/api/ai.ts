// ProShifts AI. Calls go browser → /api/proxy → Flask → NVIDIA; no AI key ever reaches the browser.
import { ApiError, api, qs } from "./client";
import type {
    AIStatus,
    ApplyResult,
    AssistantReply,
    AssistantTurn,
    CopilotResult,
    Insights,
    Recommendation,
    StaffingRequirement,
} from "@/lib/types";

export function getAIStatus(locationId: number): Promise<AIStatus> {
    return api.get<AIStatus>(`/ai/status${qs({ location_id: locationId })}`);
}

export function askAssistant(locationId: number, message: string, history: AssistantTurn[]): Promise<AssistantReply> {
    return api.post<AssistantReply>("/ai/assistant", { location_id: locationId, message, history });
}

export function generateSchedule(input: {
    locationId: number;
    weekStart: string;
    laborBudget?: number | null;
    requirements?: StaffingRequirement[];
    instructions?: string;
}): Promise<CopilotResult> {
    return api.post<CopilotResult>("/ai/schedule/generate", {
        location_id: input.locationId,
        week_start: input.weekStart,
        labor_budget: input.laborBudget ?? null,
        requirements: input.requirements ?? [],
        instructions: input.instructions ?? "",
    });
}

/** Re-validated on the server; creates DRAFT shifts only. */
export function applySchedule(locationId: number, recs: Recommendation[]): Promise<ApplyResult> {
    return api.post<ApplyResult>("/ai/schedule/apply", {
        location_id: locationId,
        shifts: recs.map((r) => ({
            user_id: r.user_id,
            date: r.date,
            start_time: r.start_time,
            end_time: r.end_time,
            role_id: r.role_id,
            existing_shift_id: r.existing_shift_id,
            break_minutes: r.break_minutes,
            reason: r.reason,
        })),
    });
}

export function getInsights(locationId: number, weekStart: string, opts: { ai?: boolean; budget?: number | null } = {}): Promise<Insights> {
    return api.get<Insights>(
        `/ai/insights${qs({ location_id: locationId, week_start: weekStart, budget: opts.budget ?? undefined, ai: opts.ai ? 1 : undefined })}`
    );
}

/** Friendly copy for AI failures; manual scheduling always keeps working. */
export function aiErrorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        switch (err.code) {
            case "AI_NOT_CONFIGURED":
                return "AI isn't set up on this server yet. You can continue scheduling manually.";
            case "AI_UNAVAILABLE":
            case "AI_TIMEOUT":
                return "AI is temporarily unavailable. You can continue scheduling manually.";
            case "AI_RATE_LIMITED":
                return "AI is busy right now. Try again in a minute.";
            case "AI_BAD_RESPONSE":
                return "The AI's answer couldn't be used. Try again or rephrase.";
        }
        if (err.status === 403 && (err.body as { required_plan?: string } | null)?.required_plan) {
            const plan = (err.body as { required_plan: string }).required_plan;
            return `This needs the ${plan[0].toUpperCase()}${plan.slice(1)} plan.`;
        }
        return err.message;
    }
    return err instanceof Error ? err.message : "Something went wrong.";
}
