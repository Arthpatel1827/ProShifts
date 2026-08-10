import { Sidebar } from "@/components/manager/sidebar";
import { TopBar } from "@/components/manager/top-bar";

export default function ManagerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />

            <div className="flex flex-1 flex-col overflow-hidden">
                <TopBar />

                <main className="flex-1 overflow-y-auto p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}