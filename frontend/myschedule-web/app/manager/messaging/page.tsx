import type { Metadata } from "next";
import { Suspense } from "react";
import MessagingPage from "@/components/manager/messaging/messaging-page";

export const metadata: Metadata = { title: "Messaging" };

export default function Page() {
    // MessagingPage reads ?channel= with useSearchParams, which needs a Suspense boundary.
    return (
        <Suspense>
            <MessagingPage />
        </Suspense>
    );
}
