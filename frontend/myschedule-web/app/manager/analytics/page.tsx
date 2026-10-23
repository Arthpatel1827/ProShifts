import type { Metadata } from "next";
import AnalyticsPage from "@/components/manager/analytics/analytics-page";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
    return <AnalyticsPage />;
}
