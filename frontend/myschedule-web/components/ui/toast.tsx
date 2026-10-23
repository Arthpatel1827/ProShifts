"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string };

type ToastApi = {
    success: (title: string, description?: string) => void;
    error: (title: string, description?: string) => void;
    info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info };
const ICON_CLASS = { success: "text-success", error: "text-destructive", info: "text-primary" };
const DURATION_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);

    const dismiss = useCallback((id: number) => {
        setToasts((list) => list.filter((t) => t.id !== id));
    }, []);

    const push = useCallback(
        (kind: ToastKind, title: string, description?: string) => {
            const id = nextId.current++;
            setToasts((list) => [...list.slice(-3), { id, kind, title, description }]);
            setTimeout(() => dismiss(id), DURATION_MS);
        },
        [dismiss]
    );

    const api = useMemo<ToastApi>(
        () => ({
            success: (t, d) => push("success", t, d),
            error: (t, d) => push("error", t, d),
            info: (t, d) => push("info", t, d),
        }),
        [push]
    );

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div
                aria-live="polite"
                className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4"
            >
                {toasts.map((t) => {
                    const Icon = ICONS[t.kind];
                    return (
                        <div
                            key={t.id}
                            role={t.kind === "error" ? "alert" : "status"}
                            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2"
                        >
                            <Icon className={cn("mt-0.5 size-4 shrink-0", ICON_CLASS[t.kind])} />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">{t.title}</p>
                                {t.description && (
                                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                                )}
                            </div>
                            <button
                                onClick={() => dismiss(t.id)}
                                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                                aria-label="Dismiss notification"
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastApi {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
    return ctx;
}
