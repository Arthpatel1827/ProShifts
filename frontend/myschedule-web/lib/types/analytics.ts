export type AnalyticsPeriod = "day" | "week" | "month";

/** GET /admin/analytics/ */
export type Analytics = {
    period: AnalyticsPeriod;
    start: string;
    end: string;
    date_label: string;
    summary: {
        scheduled_hours: number;
        worked_hours: number;
        labor_cost: number;
        coverage_pct: number;
        late_clockins: number;
        overtime_hours: number;
        total_shifts: number;
        total_staff: number;
    };
    hours_per_day: { date: string; day: string; dayNum: string; worked: number }[];
    hours_per_employee: { name: string; hours: number; role: string }[];
    trend_data: { label: string; hours: number; cost: number }[];
    hours_by_role: { role: string; hours: number; pct: number }[];
    late_list: { name: string; date: string; mins_late: number }[];
};
