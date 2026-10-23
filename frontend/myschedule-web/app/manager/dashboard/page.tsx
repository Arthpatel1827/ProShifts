import type { Metadata } from "next";
import DashboardPage from "@/components/manager/dashboard/dashboard-page";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
    return <DashboardPage />;
}
