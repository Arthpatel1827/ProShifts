import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// No marketing site lives here — send people straight to the right place.
export default async function Home() {
    const store = await cookies();
    const hasSession = store.has("myschedule_access") || store.has("myschedule_refresh");
    redirect(hasSession ? "/manager/dashboard" : "/login");
}
