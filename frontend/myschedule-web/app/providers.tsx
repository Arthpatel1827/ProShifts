"use client";

import { ToastProvider } from "@/components/ui/toast";

/**
 * App-wide client providers. Data fetching uses the lightweight `useQuery` hook in
 * lib/hooks — TanStack Query isn't part of this project, so no extra state library here.
 * Manager-only state (current user, selected location, pending counts) lives in
 * ManagerProvider, mounted by app/manager/layout.tsx.
 */
export function Providers({ children }: { children: React.ReactNode }) {
    return <ToastProvider>{children}</ToastProvider>;
}
