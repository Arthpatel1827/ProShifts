import type { Metadata, Viewport } from "next";
import KioskScreen from "@/components/kiosk/kiosk-screen";

export const metadata: Metadata = { title: "Punch In" };
export const viewport: Viewport = { themeColor: "#7B4AE2", width: "device-width", initialScale: 1, maximumScale: 1 };

export default function Page() {
    return <KioskScreen />;
}
