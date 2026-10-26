"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
/** Optional button on a toast, e.g. "Undo". */
export type ToastAction = { label: string; onClick: () => void };
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string; action?: ToastAction };

type ToastApi = {
    success: (title: string, description?: string, action?: ToastAction) => void;
    error: (title: string, description?: string, action?: ToastAction) => void;
    info: (title: string, description?: string, action?: ToastAction) => void;
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
        (kind: ToastKind, title: string, description?: string, action?: ToastAction) => {
            const id = nextId.current++;
            setToasts((list) => [...list.slice(-3), { id, kind, title, description, action }]);
            // A toast with an action (Undo) stays a little longer so it can be used.
            setTimeout(() => dismiss(id), action ? DURATION_MS * 2 : DURATION_MS);
        },
        [dismiss]
    );

    const api = useMemo<ToastApi>(
        () => ({
            success: (t, d, a) => push("success", t, d, a),
            error: (t, d, a) => push("error", t, d, a),
            info: (t, d, a) => push("info", t, d, a),
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
                            {t.action && (
                                <button
                                    onClick={() => {
                                        dismiss(t.id);
                                        t.action!.onClick();
                                    }}
                                    className="shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/10"
                                >
                                    {t.action.label}
                                </button>
                            )}
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
