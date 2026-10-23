import { api, qs } from "./client";
import type { Analytics, AnalyticsPeriod } from "@/lib/types";

export async function getAnalytics(
    locationId: number,
    period: AnalyticsPeriod,
    startDate?: string
): Promise<Analytics> {
    return api.get<Analytics>(
        `/admin/analytics/${qs({ location_id: locationId, period, start_date: startDate })}`
    );
}
