import { ManagerProvider } from "@/components/manager/manager-context";
import { ManagerShell } from "@/components/manager/manager-shell";

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
    return (
        <ManagerProvider>
            <ManagerShell>{children}</ManagerShell>
        </ManagerProvider>
    );
}
