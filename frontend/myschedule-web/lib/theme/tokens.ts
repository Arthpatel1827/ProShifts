// lib/theme/tokens.ts
// Raw brand values shared with the mobile app (frontend/myscheduleapp/src/theme/colors.ts).
// Components should prefer the Tailwind theme classes (bg-primary, text-success, …),
// which read the CSS variables in app/globals.css. Use these constants only where a
// literal colour is required (e.g. SVG strokes, <meta name="theme-color">).

export const brand = {
    primary: "#7B4AE2",
    primaryLight: "#9B6AFF",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
} as const;

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Tailwind classes for soft status pills, keyed by tone. */
export const toneClasses: Record<Tone, string> = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning-foreground dark:text-warning",
    danger: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
};

/** Live team status (from /time-entries/team-status) → tone + label. */
export const teamStatusTone = {
    working: { tone: "success", label: "Working" },
    on_break: { tone: "warning", label: "On break" },
    late: { tone: "danger", label: "Late" },
    scheduled: { tone: "neutral", label: "Scheduled" },
} as const satisfies Record<string, { tone: Tone; label: string }>;

/** Shift status → tone + label, matching the mobile app's DRAFT / LIVE wording. */
export const shiftStatusTone = {
    draft: { tone: "warning", label: "Draft" },
    published: { tone: "success", label: "Live" },
    cancelled: { tone: "neutral", label: "Cancelled" },
} as const satisfies Record<string, { tone: Tone; label: string }>;

export const MANAGER_ROLES = ["owner", "manager", "supervisor"] as const;
/** Roles the backend accepts for approving swaps, drops and time off. */
export const APPROVER_ROLES = ["owner", "manager"] as const;
